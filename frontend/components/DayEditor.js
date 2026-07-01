"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { geocode } from "@/lib/geocode";
import { osmUrl } from "@/lib/overpass";
import {
  ACCOMMODATION_TYPES,
  COST_CATEGORIES,
  CYCLING_PROFILES,
  DIFFICULTY,
  formatKr,
  formatMinutes,
} from "@/lib/constants";
import { useToast, useConfirm } from "@/components/Providers";
import ElevationProfile from "@/components/ElevationProfile";
import DayConditions from "@/components/DayConditions";
import Icon from "@/components/Icon";

// Leaflet får inte renderas på servern.
const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="muted">Laddar karta…</div>,
});

const KIND_ICON = { EXPENSE: "card", NOTE: "note", INCIDENT: "alert" };
function logClock(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Renderar och redigerar en dag. Används både i modal och på egen sida.
// `onChanged` anropas när data ändras så att förälder kan uppdatera summor.
export default function DayEditor({ dayId, onChanged }) {
  const [day, setDay] = useState(null);
  const [error, setError] = useState("");
  const toast = useToast();

  const load = useCallback(() => {
    api
      .get(`/days/${dayId}/`)
      .then(setDay)
      .catch((e) => setError(e.message));
  }, [dayId]);

  useEffect(() => {
    load();
  }, [load]);

  // Att räkna om HELA projektet (alla dagar, ruttgeometrier, statistik) är tungt.
  // Vi gör det bara EN gång när editorn stängs – inte vid varje liten ändring.
  // Under redigeringen laddas bara den aktuella dagen om (snabbt).
  const dirtyRef = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    return () => {
      if (dirtyRef.current && onChangedRef.current) onChangedRef.current();
    };
  }, []);

  const refresh = useCallback(() => {
    load();
    dirtyRef.current = true;
  }, [load]);

  if (error) return <div className="error">{error}</div>;
  if (!day) return <div className="muted">Laddar dag…</div>;

  const totalDuration = day.stages.reduce(
    (sum, s) => sum + (s.estimated_duration_minutes || 0),
    0
  );
  const actualCost = Number(day.actual_cost || 0);
  const hasActual =
    day.actual_distance_km > 0 ||
    day.actual_duration_minutes > 0 ||
    actualCost > 0 ||
    (day.logs || []).length > 0;

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <div className="card stat" style={{ marginBottom: 0 }}>
          <div className="value">{day.distance_km}</div>
          <div className="label">km planerat</div>
          {day.actual_distance_km > 0 && (
            <div className="stat-actual">{day.actual_distance_km} km verkligt</div>
          )}
        </div>
        <div className="card stat" style={{ marginBottom: 0 }}>
          <div className="value">{formatMinutes(totalDuration)}</div>
          <div className="label">beräknad tid</div>
          {day.actual_duration_minutes > 0 && (
            <div className="stat-actual">
              {formatMinutes(day.actual_duration_minutes)} verkligt
            </div>
          )}
        </div>
        <div className="card stat" style={{ marginBottom: 0 }}>
          <div className="value">{formatKr(day.total_cost)}</div>
          <div className="label">planerad kostnad</div>
          {actualCost > 0 && (
            <div className="stat-actual">{formatKr(actualCost)} spenderat</div>
          )}
        </div>
        {day.cycling_calories > 0 && (
          <div className="card stat" style={{ marginBottom: 0 }}>
            <div className="value">
              {day.cycling_calories.toLocaleString("sv-SE")}
            </div>
            <div className="label">kcal på cykeln</div>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 18 }}>
        <a
          href={`/days/${day.id}/navigate`}
          className="btn"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Icon name="navigate" size={17} /> Navigera
        </a>
        <a
          href={`/days/${day.id}/ride`}
          className="btn btn-secondary"
          style={{ flex: 1, justifyContent: "center" }}
        >
          <Icon name="bike" size={17} /> Cykelläge
        </a>
      </div>

      {!day.is_rest_day && (
        <DayConditions
          dayId={day.id}
          routeKey={day.stages
            .map((s) => `${s.id}:${s.distance_km}`)
            .join("|")}
        />
      )}

      {hasActual && (
        <ActualReview day={day} onChanged={refresh} toast={toast} />
      )}

      <RestDayToggle day={day} onChanged={refresh} toast={toast} />
      <Accommodation day={day} onSaved={refresh} toast={toast} />
      {!day.is_rest_day && (
        <Stages day={day} onChanged={refresh} toast={toast} />
      )}
      <Costs day={day} onChanged={refresh} toast={toast} />
    </>
  );
}

// --- Utfall & loggbok --------------------------------------------------------
function ActualReview({ day, onChanged, toast }) {
  const confirm = useConfirm();
  const plannedDuration = day.planned_duration_minutes;
  const actualCost = Number(day.actual_cost || 0);
  const logs = day.logs || [];

  const rows = [
    {
      label: "Sträcka",
      planned: `${day.distance_km} km`,
      actual: day.actual_distance_km > 0 ? `${day.actual_distance_km} km` : "–",
    },
    {
      label: "Cykeltid",
      planned: formatMinutes(plannedDuration),
      actual:
        day.actual_duration_minutes > 0
          ? formatMinutes(day.actual_duration_minutes)
          : "–",
    },
    {
      label: "Kostnad",
      planned: formatKr(day.total_cost),
      actual: actualCost > 0 ? formatKr(actualCost) : "–",
    },
  ];

  async function removeLog(id) {
    const ok = await confirm({
      title: "Ta bort loggposten?",
      confirmLabel: "Ta bort",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/logs/${id}/`);
      toast.success("Loggpost borttagen");
      onChanged();
    } catch (e) {
      toast.error(e.message || "Kunde inte ta bort");
    }
  }

  return (
    <div className="card" style={{ borderColor: "rgba(236,72,153,0.3)" }}>
      <h3 style={{ marginTop: 0 }}>Utfall (verkligt)</h3>
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
              <td
                style={{ textAlign: "right", fontWeight: 600, color: "var(--pink)" }}
              >
                {r.actual}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {logs.length > 0 && (
        <>
          <h4 style={{ margin: "16px 0 6px", fontSize: 14 }}>Loggbok</h4>
          <div className="logbook">
            {logs.map((l) => (
              <div key={l.id} className="log-item">
                <span className="log-icon">
                  <Icon name={KIND_ICON[l.kind]} size={16} />
                </span>
                <span className="log-time muted">{logClock(l.created_at)}</span>
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
                  onClick={() => removeLog(l.id)}
                  aria-label="Ta bort"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <p
        className="muted"
        style={{ fontSize: 12.5, marginBottom: 0, marginTop: 14, display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}
      >
        Live-loggning och GPS-spårning sker i <Icon name="bike" size={14} /> Cykelläge.
      </p>
    </div>
  );
}

// --- Vilodag -----------------------------------------------------------------
function RestDayToggle({ day, onChanged, toast }) {
  async function toggle(e) {
    const is_rest_day = e.target.checked;
    try {
      await api.patch(`/days/${day.id}/`, { is_rest_day });
      toast.success(is_rest_day ? "Markerad som vilodag" : "Vilodag borttagen");
      onChanged();
    } catch (err) {
      toast.error(err.message || "Kunde inte spara");
    }
  }

  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: day.is_rest_day ? "rgba(251,191,36,0.1)" : "var(--card)",
      }}
    >
      <input
        id="restday"
        type="checkbox"
        checked={day.is_rest_day}
        onChange={toggle}
        style={{ width: 18, height: 18 }}
      />
      <label
        htmlFor="restday"
        style={{ margin: 0, textTransform: "none", fontSize: 15, display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        <Icon name="bed" size={17} /> Vilodag (ingen cykling denna dag)
      </label>
    </div>
  );
}

// --- Boende ------------------------------------------------------------------
function Accommodation({ day, onSaved, toast }) {
  const [type, setType] = useState(day.accommodation_type || "");
  const [link, setLink] = useState(day.accommodation_link || "");

  // Synka när boendet satts utifrån (t.ex. "Använd som boende" från kartan).
  useEffect(() => {
    setType(day.accommodation_type || "");
    setLink(day.accommodation_link || "");
  }, [day.accommodation_type, day.accommodation_link]);

  // Sparar automatiskt – ingen knapp behövs (som övriga fält).
  async function patch(data, successMsg) {
    try {
      await api.patch(`/days/${day.id}/`, data);
      if (successMsg) toast.success(successMsg);
      onSaved();
    } catch (e) {
      toast.error(e.message || "Kunde inte spara boende");
    }
  }

  function changeType(value) {
    setType(value);
    patch({ accommodation_type: value }, "Boende sparat");
  }

  function saveLink() {
    if (link === (day.accommodation_link || "")) return; // oförändrat
    patch({ accommodation_link: link }, "Länk sparad");
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Boende</h3>
      <div className="grid grid-3">
        <div className="field">
          <label>Typ</label>
          <select value={type} onChange={(e) => changeType(e.target.value)}>
            <option value="">– välj –</option>
            {ACCOMMODATION_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Länk (valfritt)</label>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={saveLink}
            placeholder="https://…"
          />
        </div>
      </div>
      {link && (
        <a href={link} target="_blank" rel="noreferrer">
          Öppna länk ↗
        </a>
      )}
    </div>
  );
}

// --- Etapper -----------------------------------------------------------------
function Stages({ day, onChanged, toast }) {
  const confirm = useConfirm();
  const [activeId, setActiveId] = useState(day.stages[0]?.id || null);
  const [draftPoints, setDraftPoints] = useState({});
  const [calculating, setCalculating] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);

  const active = day.stages.find((s) => s.id === activeId) || null;
  const activePoints = draftPoints[activeId] ?? active?.waypoints ?? [];
  const isDraft = draftPoints[activeId] !== undefined;

  async function addStage() {
    try {
      const created = await api.post("/stages/", {
        day: day.id,
        order: day.stages.length,
        from_point: "",
        to_point: "",
        waypoints: [],
      });
      setActiveId(created.id);
      toast.success("Etapp tillagd");
      onChanged();
    } catch (e) {
      toast.error(e.message || "Kunde inte skapa etapp");
    }
  }

  async function deleteStage(id) {
    const ok = await confirm({
      title: "Ta bort etappen?",
      message: "Etappen och dess rutt tas bort.",
      confirmLabel: "Ta bort",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/stages/${id}/`);
    setDraftPoints((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
    toast.success("Etapp borttagen");
    onChanged();
  }

  // Flytta en etapp upp/ner genom att skriva om ordningen.
  async function move(index, dir) {
    const list = [...day.stages];
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    try {
      await Promise.all(
        list.map((s, i) =>
          s.order === i ? null : api.patch(`/stages/${s.id}/`, { order: i })
        )
      );
      onChanged();
    } catch (e) {
      toast.error(e.message || "Kunde inte ändra ordning");
    }
  }

  function setPoints(points) {
    setDraftPoints((d) => ({ ...d, [activeId]: points }));
  }

  // Sätt dagens boende från en POI man hittat på kartan.
  async function useAsAccommodation(poi) {
    try {
      await api.patch(`/days/${day.id}/`, {
        accommodation_type: poi.meta.accommodation,
        accommodation_link: poi.website || osmUrl(poi),
      });
      toast.success(`Boende satt: ${poi.name}`);
      onChanged();
    } catch (e) {
      toast.error(e.message || "Kunde inte sätta boende");
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    if (!search.trim() || !active) return;
    setSearching(true);
    try {
      const res = await geocode(search.trim());
      if (!res) {
        toast.error("Hittade ingen plats");
      } else {
        setPoints([...activePoints, res.point]);
        toast.success(`La till: ${res.label.split(",")[0]}`);
        setSearch("");
      }
    } catch (err) {
      toast.error(err.message || "Sökningen misslyckades");
    } finally {
      setSearching(false);
    }
  }

  async function saveAndCalculate() {
    if (!active) return;
    setCalculating(true);
    try {
      await api.patch(`/stages/${active.id}/`, { waypoints: activePoints });
      const result = await api.post(`/stages/${active.id}/calculate/`, {
        profile: active.profile,
      });
      setDraftPoints((d) => {
        const next = { ...d };
        delete next[active.id];
        return next;
      });
      toast.success(
        `Rutt beräknad: ${result.distance_km} km, ${formatMinutes(
          result.estimated_duration_minutes
        )}`
      );
      onChanged();
    } catch (e) {
      toast.error(e.message || "Ruttberäkning misslyckades");
    } finally {
      setCalculating(false);
    }
  }

  return (
    <div className="card">
      <div className="row space-between">
        <h3 style={{ margin: 0 }}>Etapper</h3>
        <button className="btn-secondary btn-sm" onClick={addStage}>
          + Lägg till etapp
        </button>
      </div>

      {day.stages.length === 0 && (
        <p className="muted">
          Inga etapper än. Lägg till en etapp och klicka ut rutten på kartan.
        </p>
      )}

      {day.stages.map((s, i) => (
        <StageRow
          key={s.id}
          stage={s}
          index={i}
          count={day.stages.length}
          active={s.id === activeId}
          onSelect={() => setActiveId(s.id)}
          onDelete={() => deleteStage(s.id)}
          onMove={move}
          onSavedField={onChanged}
          toast={toast}
        />
      ))}

      {active && (
        <div style={{ marginTop: 16 }}>
          <div className="row space-between" style={{ marginBottom: 8 }}>
            <strong>
              Rita rutt: {active.from_point || "?"} → {active.to_point || "?"}
            </strong>
            <div className="row">
              <button
                className="btn-secondary btn-sm"
                onClick={() => setPoints(activePoints.slice(0, -1))}
                disabled={activePoints.length === 0}
              >
                Ångra senaste
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() => setPoints([])}
                disabled={activePoints.length === 0}
              >
                Rensa punkter
              </button>
            </div>
          </div>

          {/* Adressökning */}
          <form className="row" onSubmit={runSearch} style={{ marginBottom: 8 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök plats, t.ex. Mora, och lägg till på kartan"
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn-secondary btn-sm"
              disabled={searching}
            >
              {searching ? "Söker…" : "Sök & lägg till"}
            </button>
          </form>
          <p className="muted" style={{ marginTop: 0 }}>
            Klicka på kartan eller sök för att lägga ut start, stopp och mål.
            Klicka på en befintlig pin för att ta bort den.
          </p>

          <RouteMap
            waypoints={activePoints}
            routeGeometry={isDraft ? null : active.route_geometry}
            track={day.actual_track}
            onChange={setPoints}
            onUseAsAccommodation={useAsAccommodation}
            onCalculate={saveAndCalculate}
            calculating={calculating}
            canCalculate={activePoints.length >= 2}
            routeStats={
              active.distance_km != null
                ? {
                    distance_km: active.distance_km,
                    ascent_m: active.ascent_m,
                    duration: active.estimated_duration_minutes,
                  }
                : null
            }
          />

          {!isDraft && active.route_geometry && (
            <div style={{ marginTop: 12 }}>
              <ElevationProfile geometry={active.route_geometry} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageRow({
  stage,
  index,
  count,
  active,
  onSelect,
  onDelete,
  onMove,
  onSavedField,
  toast,
}) {
  const [from, setFrom] = useState(stage.from_point);
  const [to, setTo] = useState(stage.to_point);
  const [start, setStart] = useState(stage.start_time || "");
  const [end, setEnd] = useState(stage.end_time || "");

  // Synka när servern fyllt i Från/Till automatiskt (efter ruttberäkning).
  useEffect(() => {
    setFrom(stage.from_point);
    setTo(stage.to_point);
  }, [stage.from_point, stage.to_point]);

  async function patch(data) {
    try {
      await api.patch(`/stages/${stage.id}/`, data);
      onSavedField();
    } catch (e) {
      toast.error(e.message || "Kunde inte spara");
    }
  }

  function saveField() {
    patch({
      from_point: from,
      to_point: to,
      start_time: start || null,
      end_time: end || null,
    });
  }

  const diff = DIFFICULTY[stage.difficulty_level];

  return (
    <div
      className="card"
      style={{
        marginTop: 10,
        marginBottom: 0,
        borderColor: active ? "var(--primary)" : "var(--border)",
        boxShadow: active ? "0 0 0 2px rgba(15,118,110,0.15)" : "none",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <div className="row space-between" onClick={(e) => e.stopPropagation()}>
        <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
          Etapp {index + 1}
        </span>
        <div className="row" style={{ gap: 4 }}>
          <button
            className="btn-secondary btn-sm"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            title="Flytta upp"
          >
            ↑
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => onMove(index, 1)}
            disabled={index === count - 1}
            title="Flytta ner"
          >
            ↓
          </button>
        </div>
      </div>

      <div className="grid grid-3" onClick={(e) => e.stopPropagation()}>
        <div className="field">
          <label>Från</label>
          <input value={from} onChange={(e) => setFrom(e.target.value)} onBlur={saveField} />
        </div>
        <div className="field">
          <label>Till</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} onBlur={saveField} />
        </div>
        <div className="row stage-times" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Start</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} onBlur={saveField} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Slut</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={saveField} />
          </div>
        </div>
      </div>

      <div className="grid grid-3" onClick={(e) => e.stopPropagation()}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Cykeltyp</label>
          <select
            value={stage.profile}
            onChange={(e) => patch({ profile: e.target.value })}
          >
            {CYCLING_PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="row space-between"
        style={{ marginTop: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          {stage.distance_km != null ? (
            <>
              <span><strong>{stage.distance_km}</strong> km</span>
              <span className="muted">
                ↑ {Math.round(stage.ascent_m)} m ({stage.climb_per_km} m/km)
              </span>
              <span className="badge badge-amber">
                Nivå {stage.difficulty_level} · {diff.label} · {diff.speed} km/h
              </span>
              <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Icon name="clock" size={14} /> {formatMinutes(stage.estimated_duration_minutes)}
              </span>
            </>
          ) : (
            <span className="muted">Ej beräknad – rita rutt och beräkna.</span>
          )}
        </div>
        <button className="btn-danger btn-sm" onClick={onDelete}>
          Ta bort
        </button>
      </div>
    </div>
  );
}

// --- Kostnader ---------------------------------------------------------------
function Costs({ day, onChanged, toast }) {
  const existing = useMemo(() => {
    const map = {};
    for (const c of day.costs) map[c.category] = c;
    return map;
  }, [day.costs]);

  const [values, setValues] = useState(() => {
    const v = {};
    for (const cat of COST_CATEGORIES) {
      v[cat.value] = existing[cat.value]?.amount ?? "";
    }
    return v;
  });

  async function saveCategory(category) {
    const raw = values[category];
    const amount = raw === "" ? null : Number(raw);
    const current = existing[category];
    const prev = current ? Number(current.amount) : null;
    if (amount === prev || (amount === null && prev === null)) return;

    try {
      if (amount === null || amount === 0) {
        if (current) await api.del(`/costs/${current.id}/`);
      } else if (current) {
        await api.patch(`/costs/${current.id}/`, { amount });
      } else {
        await api.post("/costs/", { day: day.id, category, amount });
      }
      toast.success("Kostnad sparad");
      onChanged();
    } catch (e) {
      toast.error(e.message || "Kunde inte spara kostnad");
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Kostnader</h3>
      <div className="grid grid-3">
        {COST_CATEGORIES.map((cat) => (
          <div className="field" key={cat.value}>
            <label>{cat.label}</label>
            <input
              type="number"
              min="0"
              placeholder="0"
              value={values[cat.value]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [cat.value]: e.target.value }))
              }
              onBlur={() => saveCategory(cat.value)}
            />
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        Totalt denna dag: <strong>{formatKr(day.total_cost)}</strong>
      </p>
    </div>
  );
}
