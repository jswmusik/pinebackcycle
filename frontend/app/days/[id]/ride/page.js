"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useToast, useConfirm } from "@/components/Providers";
import { COST_CATEGORIES, formatKr, formatMinutes } from "@/lib/constants";
import Modal from "@/components/Modal";
import { FullScreenSpinner } from "@/components/Spinner";

const RideMap = dynamic(() => import("@/components/RideMap"), {
  ssr: false,
  loading: () => <div className="ride-map-loading muted">Laddar karta…</div>,
});

function pad(n) {
  return String(n).padStart(2, "0");
}
function nowHHMM() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function logTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const KIND_ICON = { EXPENSE: "💳", NOTE: "📝", INCIDENT: "⚠️" };

// Avstånd i km mellan två [lng, lat]-punkter.
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
function formatClock(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s % 60)}s`;
}

export default function RidePage() {
  const { user, loading } = useAuth();
  const { id: dayId } = useParams();
  const toast = useToast();

  const [day, setDay] = useState(null);
  const [error, setError] = useState("");
  const [pos, setPos] = useState(null);
  const [follow, setFollow] = useState(true);
  const [geoError, setGeoError] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  const watchRef = useRef(null);

  // Tracking-state
  const [tracking, setTracking] = useState(false);
  const [track, setTrack] = useState([]); // [[lng,lat],...]
  const [trackKm, setTrackKm] = useState(0);
  const [elapsed, setElapsed] = useState(0); // sekunder
  const trackingRef = useRef(false);
  const trackRef = useRef([]);
  const kmRef = useRef(0);
  const startMsRef = useRef(null);
  const baseElapsedRef = useRef(0);
  const wakeRef = useRef(null);

  const load = useCallback(() => {
    api.get(`/days/${dayId}/`).then(setDay).catch((e) => setError(e.message));
  }, [dayId]);

  const saveTrack = useCallback(
    async (notify) => {
      if (trackRef.current.length === 0) return;
      try {
        await api.patch(`/days/${dayId}/`, {
          actual_track: trackRef.current,
          actual_distance_km: Math.round(kmRef.current * 100) / 100,
        });
        if (notify) toast.success("Tur sparad");
      } catch (e) {
        if (notify) toast.error(e.message || "Kunde inte spara turen");
      }
    },
    [dayId, toast]
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Initiera spåret från sparad data (när dagen laddas, ej under tracking).
  useEffect(() => {
    if (!day || trackingRef.current) return;
    const saved = day.actual_track || [];
    if (saved.length && trackRef.current.length === 0) {
      trackRef.current = saved;
      setTrack(saved);
      let km = 0;
      for (let i = 1; i < saved.length; i++) km += haversineKm(saved[i - 1], saved[i]);
      kmRef.current = km;
      setTrackKm(km);
    }
  }, [day]);

  // Live GPS + tracking-ackumulering.
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
        if (!trackingRef.current) return;
        if (acc != null && acc > 50) return; // för dålig noggrannhet
        const pt = [lng, lat];
        const last = trackRef.current[trackRef.current.length - 1];
        if (last) {
          const d = haversineKm(last, pt);
          if (d * 1000 < 5) return; // jitter < 5 m
          if (d > 2) return; // orimligt hopp (GPS-glitch)
          kmRef.current += d;
          setTrackKm(kmRef.current);
        }
        trackRef.current = [...trackRef.current, pt];
        setTrack(trackRef.current);
      },
      (err) => setGeoError(err.message || "Kunde inte hämta din position"),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, [user]);

  // Tidtagning medan man trackar.
  useEffect(() => {
    if (!tracking) return;
    const t = setInterval(() => {
      const running = startMsRef.current ? (Date.now() - startMsRef.current) / 1000 : 0;
      setElapsed(baseElapsedRef.current + running);
    }, 1000);
    return () => clearInterval(t);
  }, [tracking]);

  // Spara spåret periodiskt medan man trackar.
  useEffect(() => {
    if (!tracking) return;
    const t = setInterval(() => saveTrack(false), 20000);
    return () => clearInterval(t);
  }, [tracking, saveTrack]);

  // Återta Wake Lock när skärmen kommer tillbaka under tracking.
  useEffect(() => {
    async function onVis() {
      if (document.visibilityState === "visible" && trackingRef.current) {
        try {
          if ("wakeLock" in navigator) {
            wakeRef.current = await navigator.wakeLock.request("screen");
          }
        } catch {
          /* ignorera */
        }
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (loading || !user) return <FullScreenSpinner />;
  if (error) return <div className="center-screen error">{error}</div>;
  if (!day) return <FullScreenSpinner label="Laddar dagen…" />;

  async function requestWake() {
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* ignorera */
    }
  }
  function releaseWake() {
    try {
      wakeRef.current?.release();
    } catch {
      /* ignorera */
    }
    wakeRef.current = null;
  }
  async function startTracking() {
    trackingRef.current = true;
    setTracking(true);
    startMsRef.current = Date.now();
    await requestWake();
    if (!day.actual_start_time) {
      api.patch(`/days/${dayId}/`, { actual_start_time: nowHHMM() })
        .then(load)
        .catch(() => {});
    }
    toast.success("Tracking igång – håll skärmen på");
  }
  function pauseTracking() {
    trackingRef.current = false;
    setTracking(false);
    baseElapsedRef.current += startMsRef.current
      ? (Date.now() - startMsRef.current) / 1000
      : 0;
    startMsRef.current = null;
    releaseWake();
    saveTrack(false);
  }
  async function stopTracking() {
    trackingRef.current = false;
    setTracking(false);
    baseElapsedRef.current += startMsRef.current
      ? (Date.now() - startMsRef.current) / 1000
      : 0;
    startMsRef.current = null;
    releaseWake();
    try {
      await api.patch(`/days/${dayId}/`, {
        actual_track: trackRef.current,
        actual_distance_km: Math.round(kmRef.current * 100) / 100,
        actual_end_time: nowHHMM(),
      });
      toast.success(`Tur avslutad: ${kmRef.current.toFixed(1)} km`);
      load();
    } catch (e) {
      toast.error(e.message || "Kunde inte spara turen");
    }
  }
  const avgSpeed = elapsed > 0 ? (trackKm / (elapsed / 3600)) : 0;

  const geometries = (day.stages || []).map((s) => s.route_geometry).filter(Boolean);

  return (
    <div className="ride-page">
      {/* Header */}
      <div className="ride-header">
        <a href={`/projects/${day.project}`} className="ride-back" aria-label="Tillbaka">
          ✕
        </a>
        <div className="ride-title">
          <strong>{day.weekday}</strong>
          <span className="muted">{day.date}</span>
        </div>
        <div className="ride-nav">
          <a
            className={`ride-navbtn ${!day.prev_day_id ? "disabled" : ""}`}
            href={day.prev_day_id ? `/days/${day.prev_day_id}/ride` : undefined}
          >
            ‹
          </a>
          <a
            className={`ride-navbtn ${!day.next_day_id ? "disabled" : ""}`}
            href={day.next_day_id ? `/days/${day.next_day_id}/ride` : undefined}
          >
            ›
          </a>
        </div>
      </div>

      {/* Karta */}
      <div className="ride-map">
        {geometries.length || track.length || pos ? (
          <RideMap
            geometries={geometries}
            track={track}
            position={pos}
            follow={follow}
          />
        ) : (
          <div className="ride-map-loading muted">
            Ingen rutt eller position än. Planera dagen eller starta en tur.
          </div>
        )}
        <div className="ride-map-controls">
          <button
            className={`ride-followbtn ${follow ? "active" : ""}`}
            onClick={() => setFollow((f) => !f)}
            title="Följ min position"
          >
            {follow ? "🎯 Följer" : "🎯 Följ"}
          </button>
        </div>
        {geoError && <div className="ride-geo-error">{geoError}</div>}
      </div>

      {/* Nyckeltal */}
      <div className="ride-metrics">
        <Metric label="Sträcka (plan)" value={`${day.distance_km} km`} />
        <Metric label="Cykeltid (plan)" value={formatMinutes(day.planned_duration_minutes)} />
        {day.cycling_calories > 0 && (
          <Metric label="Kalorier" value={`${day.cycling_calories.toLocaleString("sv-SE")}`} />
        )}
        <Metric label="Spenderat" value={formatKr(day.actual_cost)} />
      </div>

      {/* Innehåll */}
      <div className="ride-content">
        <div className="card tracker-card">
          <div className="tracker-stats">
            <div className="tracker-stat">
              <div className="tracker-value">{trackKm.toFixed(2)}</div>
              <div className="tracker-label">km cyklat</div>
            </div>
            <div className="tracker-stat">
              <div className="tracker-value">{formatClock(elapsed)}</div>
              <div className="tracker-label">tid</div>
            </div>
            <div className="tracker-stat">
              <div className="tracker-value">{avgSpeed.toFixed(1)}</div>
              <div className="tracker-label">km/h snitt</div>
            </div>
          </div>

          {tracking ? (
            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn-secondary"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={pauseTracking}
              >
                ⏸ Paus
              </button>
              <button
                className="btn-danger"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={stopTracking}
              >
                ⏹ Avsluta
              </button>
            </div>
          ) : (
            <div className="row" style={{ gap: 10 }}>
              <button
                style={{ flex: 1, justifyContent: "center" }}
                onClick={startTracking}
              >
                ▶ {trackKm > 0 ? "Fortsätt tur" : "Starta tur"}
              </button>
              {trackKm > 0 && (
                <button
                  className="btn-danger"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={stopTracking}
                >
                  ⏹ Avsluta
                </button>
              )}
            </div>
          )}
          {tracking ? (
            <p className="muted tracker-hint">
              📍 Spårar… håll skärmen på och appen i förgrunden.
            </p>
          ) : (
            <p className="muted tracker-hint">
              Spelar in din väg och fyller i faktisk sträcka & tid automatiskt.
            </p>
          )}
        </div>

        <ActualPanel day={day} onSaved={load} toast={toast} />
        <Outcome day={day} />
        <Logbook day={day} onChanged={load} toast={toast} />
      </div>

      {/* Logga-knapp */}
      <button className="ride-fab" onClick={() => setLogOpen(true)}>
        + Logga
      </button>

      {logOpen && (
        <LogSheet
          dayId={day.id}
          onClose={() => setLogOpen(false)}
          onSaved={() => {
            setLogOpen(false);
            load();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-chip">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

// --- Verkligt idag (faktisk sträcka/tid) -------------------------------------
function ActualPanel({ day, onSaved, toast }) {
  const [km, setKm] = useState(day.actual_distance_km ?? "");
  const [start, setStart] = useState((day.actual_start_time || "").slice(0, 5));
  const [end, setEnd] = useState((day.actual_end_time || "").slice(0, 5));

  useEffect(() => {
    setKm(day.actual_distance_km ?? "");
    setStart((day.actual_start_time || "").slice(0, 5));
    setEnd((day.actual_end_time || "").slice(0, 5));
  }, [day.actual_distance_km, day.actual_start_time, day.actual_end_time]);

  async function patch(data, msg) {
    try {
      await api.patch(`/days/${day.id}/`, data);
      if (msg) toast.success(msg);
      onSaved();
    } catch (e) {
      toast.error(e.message || "Kunde inte spara");
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Verkligt idag</h3>
      <div className="grid grid-3">
        <div className="field">
          <label>Faktisk sträcka (km)</label>
          <input
            type="number"
            inputMode="decimal"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            onBlur={() =>
              patch({ actual_distance_km: km === "" ? null : Number(km) })
            }
            placeholder={`plan: ${day.distance_km}`}
          />
        </div>
        <div className="field">
          <label>Starttid</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => patch({ actual_start_time: start || null })}
            />
            <button
              className="btn-secondary btn-sm"
              onClick={() => {
                const t = nowHHMM();
                setStart(t);
                patch({ actual_start_time: t }, "Starttid satt");
              }}
            >
              Nu
            </button>
          </div>
        </div>
        <div className="field">
          <label>Sluttid</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onBlur={() => patch({ actual_end_time: end || null })}
            />
            <button
              className="btn-secondary btn-sm"
              onClick={() => {
                const t = nowHHMM();
                setEnd(t);
                patch({ actual_end_time: t }, "Sluttid satt");
              }}
            >
              Nu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Utfall (planerat vs verkligt) -------------------------------------------
function Outcome({ day }) {
  const rows = [
    {
      label: "Kostnad",
      planned: formatKr(day.total_cost),
      actual: formatKr(day.actual_cost),
      diff: Number(day.actual_cost) - Number(day.total_cost),
      money: true,
    },
    {
      label: "Sträcka",
      planned: `${day.distance_km} km`,
      actual: day.actual_distance_km != null ? `${day.actual_distance_km} km` : "–",
      diff:
        day.actual_distance_km != null
          ? day.actual_distance_km - day.distance_km
          : null,
    },
    {
      label: "Cykeltid",
      planned: formatMinutes(day.planned_duration_minutes),
      actual:
        day.actual_duration_minutes != null
          ? formatMinutes(day.actual_duration_minutes)
          : "–",
      diff: null,
    },
  ];

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Utfall idag</h3>
      <table className="outcome-table">
        <thead>
          <tr>
            <th></th>
            <th style={{ textAlign: "right" }}>Planerat</th>
            <th style={{ textAlign: "right" }}>Verkligt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td style={{ textAlign: "right" }} className="muted">
                {r.planned}
              </td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>
                {r.actual}
                {r.money && Number(day.actual_cost) > 0 && (
                  <span
                    className="muted"
                    style={{
                      fontSize: 12,
                      marginLeft: 6,
                      color: r.diff > 0 ? "var(--red)" : "var(--green)",
                    }}
                  >
                    {r.diff > 0 ? "+" : ""}
                    {formatKr(r.diff)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Loggbok -----------------------------------------------------------------
function Logbook({ day, onChanged, toast }) {
  const confirm = useConfirm();
  const logs = day.logs || [];

  async function remove(id) {
    const ok = await confirm({
      title: "Ta bort loggposten?",
      confirmLabel: "Ta bort",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/logs/${id}/`);
    toast.success("Loggpost borttagen");
    onChanged();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Loggbok</h3>
      {logs.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Inget loggat än. Tryck på <strong>+ Logga</strong> för att registrera
          en utgift, anteckning eller händelse.
        </p>
      ) : (
        <div className="logbook">
          {logs.map((l) => (
            <div key={l.id} className="log-item">
              <span className="log-icon">{KIND_ICON[l.kind]}</span>
              <span className="log-time muted">{logTime(l.created_at)}</span>
              <span className="log-text">
                {l.category && (
                  <span className="muted">
                    {COST_CATEGORIES.find((c) => c.value === l.category)?.label}
                    {l.text ? " · " : ""}
                  </span>
                )}
                {l.text}
              </span>
              {l.amount != null && (
                <span className="log-amount">{formatKr(l.amount)}</span>
              )}
              <button
                className="log-del"
                onClick={() => remove(l.id)}
                aria-label="Ta bort"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Logga-formulär (bottensheet/modal) --------------------------------------
function LogSheet({ dayId, onClose, onSaved, toast }) {
  const [kind, setKind] = useState("EXPENSE");
  const [category, setCategory] = useState("LUNCH");
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (kind === "EXPENSE" && !amount) {
      toast.error("Ange ett belopp");
      return;
    }
    if (kind !== "EXPENSE" && !text.trim()) {
      toast.error("Skriv något");
      return;
    }
    setBusy(true);
    try {
      await api.post("/logs/", {
        day: dayId,
        kind,
        text,
        category: kind === "EXPENSE" ? category : "",
        amount: kind === "EXPENSE" ? Number(amount) : null,
      });
      toast.success("Loggat");
      onSaved();
    } catch (e) {
      toast.error(e.message || "Kunde inte logga");
      setBusy(false);
    }
  }

  return (
    <Modal title="Logga" onClose={onClose} maxWidth={460}>
      <div className="segmented">
        {[
          ["EXPENSE", "💳 Utgift"],
          ["NOTE", "📝 Anteckning"],
          ["INCIDENT", "⚠️ Händelse"],
        ].map(([val, label]) => (
          <button
            key={val}
            className={`seg-btn ${kind === val ? "active" : ""}`}
            onClick={() => setKind(val)}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "EXPENSE" && (
        <div className="grid grid-3" style={{ marginTop: 14 }}>
          <div className="field">
            <label>Belopp (kr)</label>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Kategori</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {COST_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="field" style={{ marginTop: kind === "EXPENSE" ? 0 : 14 }}>
        <label>{kind === "EXPENSE" ? "Notering (valfritt)" : "Text"}</label>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            kind === "INCIDENT"
              ? "t.ex. Punktering, 30 min"
              : kind === "NOTE"
              ? "t.ex. Vacker utsikt vid sjön"
              : "t.ex. Lunch på café"
          }
        />
      </div>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
        <button className="btn-secondary" onClick={onClose}>
          Avbryt
        </button>
        <button onClick={save} disabled={busy}>
          {busy ? "Sparar…" : "Spara"}
        </button>
      </div>
    </Modal>
  );
}
