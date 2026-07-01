"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatMinutes } from "@/lib/constants";
import Icon from "@/components/Icon";

// WMO-väderkod → platt ikon + svensk etikett.
function wmo(code) {
  if (code === 0) return { icon: "sun", label: "Klart" };
  if (code === 1 || code === 2) return { icon: "cloud-sun", label: "Växlande moln" };
  if (code === 3) return { icon: "cloud", label: "Mulet" };
  if (code === 45 || code === 48) return { icon: "cloud-fog", label: "Dimma" };
  if (code >= 51 && code <= 57) return { icon: "cloud-rain", label: "Duggregn" };
  if (code >= 61 && code <= 67) return { icon: "cloud-rain", label: "Regn" };
  if (code >= 71 && code <= 77) return { icon: "cloud-snow", label: "Snö" };
  if (code >= 80 && code <= 82) return { icon: "cloud-rain", label: "Regnskurar" };
  if (code === 85 || code === 86) return { icon: "cloud-snow", label: "Snöbyar" };
  if (code >= 95) return { icon: "cloud-lightning", label: "Åska" };
  return { icon: "cloud", label: "Moln" };
}

const EFFECT = {
  headwind: { label: "Motvind", color: "var(--red)" },
  tailwind: { label: "Medvind", color: "var(--green)" },
  crosswind: { label: "Sidvind", color: "var(--muted)" },
};

export default function DayConditions({ dayId, routeKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/days/${dayId}/conditions/`)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [dayId, routeKey]);

  if (loading) {
    return (
      <div className="card muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="sun" size={16} /> Hämtar dagens förutsättningar…
      </div>
    );
  }
  if (!data || (!data.available && data.reason === "rest_day")) return null;

  if (!data.available) {
    // Enda kvarvarande fallet: ingen rutt beräknad än.
    return (
      <div className="card conditions-card">
        <h3 style={{ marginTop: 0 }}>Dagens förutsättningar</h3>
        <p className="muted" style={{ margin: 0 }}>
          Beräkna en rutt så visar vi väder, vind och förväntad statistik för dagen.
        </p>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="card conditions-card">
      <h3 style={{ marginTop: 0 }}>Dagens förutsättningar</h3>

      {data.forecast ? (
        <>
          <div className="cond-hero">
            <Icon name={wmo(s.worst_code).icon} size={34} tone="pink" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cond-temp">
                {s.temp_min}–{s.temp_max}°
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {wmo(s.worst_code).label}
                {s.rain ? ` · ${s.precip_prob_max}% regnrisk` : ""}
              </div>
            </div>
            <div className="cond-wind" style={{ color: EFFECT[s.wind_effect].color }}>
              <Icon name="wind" size={20} />
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontWeight: 700 }}>{EFFECT[s.wind_effect].label}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.wind_avg_kmh} km/h
                </div>
              </div>
            </div>
          </div>

          <div className="cond-timeline">
            {data.points.map((p, i) => (
              <div key={i} className="cond-point">
                <div className="cond-time">{p.time}</div>
                <Icon name={wmo(p.code).icon} size={22} />
                <div className="cond-ptemp">{p.temp}°</div>
                <div className="cond-pwind" style={{ color: EFFECT[p.effect].color }}>
                  <Icon
                    name="arrow-up"
                    size={13}
                    style={{ transform: `rotate(${p.wind_dir + 180}deg)` }}
                  />
                  {p.wind_kmh}
                </div>
                <div className="cond-pkm muted">{p.km} km</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          {data.reason === "too_far"
            ? `Väderprognos blir tillgänglig närmare avresan (${data.days_until} dagar kvar).`
            : data.reason === "past"
            ? "Dagen har passerat – väderprognos visas inte."
            : "Kunde inte hämta väderdata just nu, försök igen senare."}
        </p>
      )}

      {data.stats && (
        <div className="cond-stats">
          <span>
            <Icon name="ruler" size={15} /> {data.stats.distance_km} km
          </span>
          <span>
            <Icon name="mountain" size={15} /> ↑ {data.stats.ascent_m} m
          </span>
          <span>
            <Icon name="clock" size={15} /> {formatMinutes(data.stats.duration_min)}
          </span>
          {data.stats.calories > 0 && (
            <span>
              <Icon name="flame" size={15} tone="pink" />{" "}
              {Math.round(data.stats.calories).toLocaleString("sv-SE")} kcal
            </span>
          )}
        </div>
      )}
    </div>
  );
}
