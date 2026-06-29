"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useToast } from "@/components/Providers";
import { FullScreenSpinner } from "@/components/Spinner";

const NavMap = dynamic(() => import("@/components/NavMap"), {
  ssr: false,
  loading: () => <div className="ride-map-loading muted">Laddar karta…</div>,
});

// ORS-manövertyp -> [ikon, svensk text]
const MAN = {
  0: ["↰", "Sväng vänster"],
  1: ["↱", "Sväng höger"],
  2: ["↰", "Skarp vänster"],
  3: ["↱", "Skarp höger"],
  4: ["↖", "Svagt vänster"],
  5: ["↗", "Svagt höger"],
  6: ["↑", "Fortsätt rakt fram"],
  7: ["⟳", "In i rondellen"],
  8: ["⟳", "Ut ur rondellen"],
  9: ["↩", "U-sväng"],
  10: ["🏁", "Framme"],
  11: ["▲", "Kör iväg"],
  12: ["↖", "Håll vänster"],
  13: ["↗", "Håll höger"],
};

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  // a,b = [lng,lat]
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
function fmtDist(km) {
  if (km < 1) return `${Math.round((km * 1000) / 10) * 10} m`;
  return `${km.toFixed(1)} km`;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function manText(step) {
  const [icon, phrase] = MAN[step.type] || ["↑", "Fortsätt"];
  let text = phrase;
  if (step.name && [0, 1, 2, 3, 4, 5, 11].includes(step.type)) {
    text += ` in på ${step.name}`;
  } else if (step.name && (step.type === 12 || step.type === 13)) {
    text += ` mot ${step.name}`;
  }
  return { icon, text };
}

export default function NavigatePage() {
  const { user, loading } = useAuth();
  const { id: dayId } = useParams();
  const toast = useToast();

  const [day, setDay] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState(null); // [lat,lng]
  const [heading, setHeading] = useState(null);
  const [trackKm, setTrackKm] = useState(0);
  const [trackPts, setTrackPts] = useState([]);
  const [activeRoute, setActiveRoute] = useState(null); // omräknad rutt
  const [geoError, setGeoError] = useState("");

  const trackRef = useRef([]);
  const kmRef = useRef(0);
  const watchRef = useRef(null);
  const wakeRef = useRef(null);
  const activeRef = useRef(false);
  const offSinceRef = useRef(null);
  const lastRerouteRef = useRef(0);
  const reroutingRef = useRef(false);

  const load = useCallback(() => {
    api.get(`/days/${dayId}/`).then(setDay).catch((e) => setError(e.message));
  }, [dayId]);
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Bygg dagens sammanhängande rutt + manövrar + kumulativ distans.
  const route = useMemo(() => {
    if (!day) return null;
    const coords = [];
    const steps = [];
    for (const st of day.stages || []) {
      const g = st.route_geometry?.coordinates;
      if (!g || g.length < 2) continue;
      const offset = coords.length;
      for (const c of g) coords.push(c);
      for (const s of st.route_steps || []) {
        steps.push({ ...s, wp: (s.way_point || 0) + offset });
      }
    }
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + haversineKm(coords[i - 1], coords[i]));
    }
    return { coords, steps, cum, total: cum[cum.length - 1] || 0 };
  }, [day]);

  const saveTrack = useCallback(async () => {
    if (trackRef.current.length === 0) return;
    try {
      await api.patch(`/days/${dayId}/`, {
        actual_track: trackRef.current,
        actual_distance_km: Math.round(kmRef.current * 100) / 100,
      });
    } catch {
      /* tyst – sparas igen strax */
    }
  }, [dayId]);

  // Seed spår från ev. redan inspelad data.
  useEffect(() => {
    if (!day || trackRef.current.length) return;
    const saved = day.actual_track || [];
    if (saved.length) {
      trackRef.current = saved;
      setTrackPts(saved);
      let km = 0;
      for (let i = 1; i < saved.length; i++) km += haversineKm(saved[i - 1], saved[i]);
      kmRef.current = km;
      setTrackKm(km);
    }
  }, [day]);

  // GPS-watch (positionsvisning + spårning när aktiv).
  useEffect(() => {
    if (!user) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Enheten saknar GPS-stöd.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        const acc = p.coords.accuracy;
        setPos([lat, lng]);
        setGeoError("");
        if (p.coords.heading != null && !Number.isNaN(p.coords.heading)) {
          setHeading(p.coords.heading);
        }
        if (!activeRef.current) return;
        if (acc != null && acc > 50) return;
        const pt = [lng, lat];
        const last = trackRef.current[trackRef.current.length - 1];
        if (last) {
          const d = haversineKm(last, pt);
          if (d * 1000 < 5) return;
          if (d > 2) return;
          // Härled riktning från rörelse om enheten saknar heading.
          if (p.coords.heading == null) setHeading(bearing(last, pt));
          kmRef.current += d;
          setTrackKm(kmRef.current);
        }
        trackRef.current = [...trackRef.current, pt];
        setTrackPts(trackRef.current);
      },
      (err) => setGeoError(err.message || "Kunde inte hämta din position"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [user]);

  // Periodisk sparning medan aktiv.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(saveTrack, 15000);
    return () => clearInterval(t);
  }, [active, saveTrack]);

  // Auto-omräkning: om man varit av rutten ett tag, beräkna ny väg till målet.
  useEffect(() => {
    if (!active || !pos) return;
    const gr = activeRoute || route;
    if (!gr || gr.coords.length < 2 || !route) return;
    const me = [pos[1], pos[0]];
    let best = Infinity;
    for (const c of gr.coords) {
      const d = haversineKm(me, c);
      if (d < best) best = d;
    }
    if (best <= 0.05) {
      offSinceRef.current = null;
      return;
    }
    // Räkna inte om om man är orimligt långt bort (t.ex. test hemifrån).
    if (best > 5) return;
    if (!offSinceRef.current) offSinceRef.current = Date.now();
    const offFor = Date.now() - offSinceRef.current;
    if (
      offFor > 12000 &&
      Date.now() - lastRerouteRef.current > 15000 &&
      !reroutingRef.current
    ) {
      reroutingRef.current = true;
      lastRerouteRef.current = Date.now();
      const dest = route.coords[route.coords.length - 1];
      api
        .post("/route/", { coordinates: [me, dest] })
        .then((res) => {
          const c = res.geometry?.coordinates;
          if (c && c.length > 1) {
            const cum = [0];
            for (let i = 1; i < c.length; i++) {
              cum.push(cum[i - 1] + haversineKm(c[i - 1], c[i]));
            }
            const steps = (res.steps || []).map((s) => ({
              ...s,
              wp: s.way_point || 0,
            }));
            setActiveRoute({ coords: c, steps, cum, total: cum[cum.length - 1] || 0 });
            offSinceRef.current = null;
            toast.info("Ny rutt beräknad");
          }
        })
        .catch(() => {})
        .finally(() => {
          reroutingRef.current = false;
        });
    }
  }, [pos, active, activeRoute, route, toast]);

  if (loading || !user) return <FullScreenSpinner />;
  if (error) return <div className="center-screen error">{error}</div>;
  if (!day) return <FullScreenSpinner label="Laddar navigering…" />;

  const hasRoute = route && route.coords.length > 1;
  // Vägledning sker längs den omräknade rutten om en sådan finns, annars planen.
  const guidanceRoute = activeRoute || route;
  const navigating = active;

  // --- Navigationsberäkning ---
  let guidance = null;
  let remainingKm = null;
  let offRoute = false;
  let maneuverLatLng = null;

  if (guidanceRoute && guidanceRoute.coords.length > 1 && pos) {
    const me = [pos[1], pos[0]]; // [lng,lat]
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < guidanceRoute.coords.length; i++) {
      const d = haversineKm(me, guidanceRoute.coords[i]);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    offRoute = best > 0.04; // > 40 m från rutten
    remainingKm = Math.max(0, guidanceRoute.total - guidanceRoute.cum[nearest]);

    const next = guidanceRoute.steps.find((s) => s.wp >= nearest + 1) || null;
    if (next) {
      const c = guidanceRoute.coords[Math.min(next.wp, guidanceRoute.coords.length - 1)];
      maneuverLatLng = [c[1], c[0]];
      const { icon, text } = manText(next);
      guidance = { icon, text, dist: haversineKm(me, c) };
    } else if (remainingKm < 0.05) {
      guidance = { icon: "🏁", text: "Framme vid målet", dist: 0 };
    }
  }

  async function requestWake() {
    try {
      if ("wakeLock" in navigator) wakeRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* ignorera */
    }
  }
  async function start() {
    activeRef.current = true;
    setActive(true);
    await requestWake();
    if (!day.actual_start_time) {
      api.patch(`/days/${dayId}/`, { actual_start_time: nowHHMM() }).then(load).catch(() => {});
    }
    toast.success("Navigering igång – håll skärmen på");
  }
  async function stop() {
    activeRef.current = false;
    setActive(false);
    try {
      wakeRef.current?.release();
    } catch {
      /* ignorera */
    }
    wakeRef.current = null;
    await api.patch(`/days/${dayId}/`, {
      actual_track: trackRef.current,
      actual_distance_km: Math.round(kmRef.current * 100) / 100,
      actual_end_time: nowHHMM(),
    });
    toast.success(`Tur sparad: ${kmRef.current.toFixed(1)} km`);
    load();
  }

  return (
    <div className="nav-page">
      {/* Topp: nästa sväng */}
      {navigating && (
        <div className={`nav-banner ${offRoute ? "off" : ""}`}>
          {offRoute ? (
            <>
              <span className="nav-icon">⚠️</span>
              <div className="nav-textwrap">
                <div className="nav-instruction">Du är av rutten</div>
                <div className="nav-sub">Ta dig tillbaka till den lila linjen</div>
              </div>
            </>
          ) : guidance ? (
            <>
              <span className="nav-icon">{guidance.icon}</span>
              <div className="nav-textwrap">
                <div className="nav-dist">om {fmtDist(guidance.dist)}</div>
                <div className="nav-instruction">{guidance.text}</div>
              </div>
            </>
          ) : (
            <>
              <span className="nav-icon">🧭</span>
              <div className="nav-textwrap">
                <div className="nav-instruction">Följ rutten</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Karta */}
      <div className="nav-map">
        {hasRoute ? (
          <NavMap
            coords={guidanceRoute.coords}
            track={trackPts}
            position={pos}
            heading={heading}
            maneuver={navigating ? maneuverLatLng : null}
            follow={navigating}
          />
        ) : (
          <div className="ride-map-loading muted">
            Ingen beräknad rutt för dagen. Planera och beräkna dagens etapper först.
          </div>
        )}
        {geoError && <div className="ride-geo-error">{geoError}</div>}
        <a href={`/projects/${day.project}`} className="nav-exit" aria-label="Avsluta">
          ✕
        </a>
      </div>

      {/* Botten: status + start/stopp */}
      <div className="nav-bottom">
        {active ? (
          <>
            <div className="nav-stats">
              <div>
                <div className="nav-stat-val">
                  {remainingKm != null ? fmtDist(remainingKm) : "–"}
                </div>
                <div className="nav-stat-lbl">kvar till mål</div>
              </div>
              <div>
                <div className="nav-stat-val">{trackKm.toFixed(1)} km</div>
                <div className="nav-stat-lbl">cyklat</div>
              </div>
            </div>
            <button className="btn-danger" onClick={stop}>
              ⏹ Avsluta
            </button>
          </>
        ) : (
          <button
            onClick={start}
            disabled={!hasRoute}
            style={{ width: "100%", justifyContent: "center" }}
          >
            ▶ Starta navigering
          </button>
        )}
      </div>
    </div>
  );
}
