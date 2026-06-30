"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { formatKr, formatMinutes, DIFFICULTY, GENDERS } from "@/lib/constants";
import { useToast, useConfirm } from "@/components/Providers";
import TopBar from "@/components/TopBar";
import Modal from "@/components/Modal";
import DayEditor from "@/components/DayEditor";
import { FullScreenSpinner } from "@/components/Spinner";
import Icon from "@/components/Icon";

const FullRouteMap = dynamic(() => import("@/components/FullRouteMap"), {
  ssr: false,
  loading: () => <div className="muted">Laddar karta…</div>,
});

export default function ProjectPage() {
  const { user, loading } = useAuth();
  const params = useParams();
  const projectId = params.id;
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [openDay, setOpenDay] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api
      .get(`/projects/${projectId}/`)
      .then(setProject)
      .catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user) return <FullScreenSpinner />;
  if (error) return <div className="center-screen error">{error}</div>;
  if (!project) return <FullScreenSpinner label="Laddar semestern…" />;

  const s = project.stats;
  const budgetByDay = {};
  for (const b of project.daily_budgets) budgetByDay[b.day_id] = b;
  const overBudget = Number(project.budget_remaining) < 0;

  const geometries = project.days
    .flatMap((d) => d.stages)
    .map((st) => st.route_geometry)
    .filter(Boolean);

  const tracks = project.days
    .map((d) => d.actual_track)
    .filter((t) => t && t.length > 1);

  const hasActual =
    s.actual_distance_km > 0 ||
    s.actual_total_cost > 0 ||
    s.actual_duration_minutes > 0;

  async function deleteProject() {
    const ok = await confirm({
      title: "Ta bort semestern?",
      message: `"${project.title}" och all dess data tas bort permanent.`,
      confirmLabel: "Ta bort",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/projects/${projectId}/`);
    toast.success("Semestern borttagen");
    router.push("/");
  }

  return (
    <>
      <TopBar user={user} />
      <div className="container">
        <a href="/" className="back-link no-print">
          ← Alla semestrar
        </a>
        <div className="row space-between" style={{ margin: "10px 0 18px" }}>
          <h2 className="page-title">{project.title}</h2>
          <div className="row no-print">
            <button className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
              Redigera
            </button>
            <button className="btn-secondary btn-sm" onClick={() => window.print()}>
              Skriv ut / PDF
            </button>
            <button className="btn-danger btn-sm" onClick={deleteProject}>
              Ta bort
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: -10 }}>
          {project.start_date} – {project.end_date}
        </p>

        {/* Budget-toppen */}
        <div className="summary-stats">
          <div className="card hero-stat">
            <span className="hero-icon"><Icon name="ruler" size={24} /></span>
            <div>
              <div className="hero-value">{s.total_distance_km}</div>
              <div className="hero-label">km totalt</div>
            </div>
          </div>
          <div className="card hero-stat">
            <span className="hero-icon"><Icon name="card" size={24} /></span>
            <div>
              <div className="hero-value">{formatKr(project.total_cost)}</div>
              <div className="hero-label">av {formatKr(project.budget)}</div>
            </div>
          </div>
          <div className="card hero-stat">
            <span className="hero-icon">
              <Icon name={overBudget ? "alert" : "wallet"} size={24} tone={overBudget ? undefined : "pink"} />
            </span>
            <div>
              <div
                className="hero-value"
                style={{ color: overBudget ? "var(--red)" : "var(--green)" }}
              >
                {formatKr(project.budget_remaining)}
              </div>
              <div className="hero-label">
                {overBudget ? "över budget" : "kvar"}
              </div>
            </div>
          </div>
        </div>

        {/* Hela rutten */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Hela rutten</h3>
          <FullRouteMap geometries={geometries} tracks={tracks} />
        </div>

        {hasActual && <PlannedVsActual stats={s} />}

        {/* KPI:er */}
        <Collapsible
          title="Statistik"
          summary={`${s.total_distance_km} km · ${s.cycling_day_count} cykeldagar · ↑ ${s.total_ascent_m} m`}
        >
          <div className="kpi-grid">
            <Kpi label="Cykeldagar" value={s.cycling_day_count} />
            <Kpi label="Vilodagar" value={s.rest_day_count} icon="bed" />
            <Kpi label="Snitt km / cykeldag" value={s.avg_km_per_cycling_day} />
            <Kpi label="Längsta dag (km)" value={s.longest_day_km} />
            <Kpi label="Total cykeltid" value={formatMinutes(s.total_duration_minutes)} />
            <Kpi label="Total stigning" value={`${s.total_ascent_m} m`} icon="mountain" />
            <Kpi label="Total nedför" value={`${s.total_descent_m} m`} />
            <Kpi label="Högsta punkt" value={`${s.highest_point_m} m`} />
            <Kpi
              label="Snittsvårighet"
              value={`${s.avg_difficulty} (${
                DIFFICULTY[Math.round(s.avg_difficulty)]?.label || "–"
              })`}
            />
            <Kpi label="Antal etapper" value={s.stage_count} />
            <Kpi label="Länder" value={s.country_count} icon="globe" />
            <Kpi label="Kostnad / km" value={formatKr(s.cost_per_km)} />
            <Kpi label="Snittkostnad / dag" value={formatKr(s.avg_cost_per_day)} />
          </div>
        </Collapsible>

        <Calories stats={s} onEdit={() => setEditing(true)} />

        {s.countries.length > 0 && <Countries countries={s.countries} />}

        {/* Dagar */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Dagsplanering</h3>
          <DayList
            days={project.days}
            budgetByDay={budgetByDay}
            hasCalorieProfile={s.has_calorie_profile}
            onOpen={(day) =>
              setOpenDay({ id: day.id, date: day.date, weekday: day.weekday })
            }
          />
        </div>
      </div>

      {openDay && (
        <Modal
          title={`${openDay.weekday} ${openDay.date}`}
          onClose={() => setOpenDay(null)}
        >
          <DayEditor dayId={openDay.id} onChanged={load} />
        </Modal>
      )}

      {editing && (
        <EditProjectModal
          project={project}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </>
  );
}

// Riktig flagg-bild (SVG från flagcdn.com). Emoji-flaggor funkar inte på
// Windows, så vi använder bilder istället.
function Flag({ code, height = 14 }) {
  if (!code || code.length !== 2) return null;
  return (
    <img
      src={`https://flagcdn.com/${code.toLowerCase()}.svg`}
      alt={code}
      style={{
        height,
        width: "auto",
        borderRadius: 2,
        verticalAlign: "middle",
        boxShadow: "0 0 0 0.5px rgba(0,0,0,0.15)",
      }}
    />
  );
}

function Collapsible({ title, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card collapsible">
      <button
        className="collapsible-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible-titles">
          <span className="collapsible-title">{title}</span>
          {!open && summary && (
            <span className="collapsible-summary muted">{summary}</span>
          )}
        </span>
        <span className={`collapsible-chevron ${open ? "open" : ""}`} aria-hidden>
          ⌄
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

function PlannedVsActual({ stats }) {
  const rows = [
    {
      label: "Sträcka",
      planned: `${stats.total_distance_km} km`,
      actual: `${stats.actual_distance_km} km`,
      diff: stats.actual_distance_km - stats.total_distance_km,
      unit: "km",
    },
    {
      label: "Cykeltid",
      planned: formatMinutes(stats.planned_duration_minutes),
      actual: stats.actual_duration_minutes
        ? formatMinutes(stats.actual_duration_minutes)
        : "–",
      diff: null,
    },
    {
      label: "Kostnad",
      planned: formatKr(stats.planned_total_cost),
      actual: formatKr(stats.actual_total_cost),
      diff: stats.actual_total_cost - stats.planned_total_cost,
      money: true,
    },
  ];

  const summary = `${stats.actual_distance_km} av ${stats.total_distance_km} km · ${formatKr(stats.actual_total_cost)} spenderat`;

  return (
    <Collapsible title="Planerat vs verkligt" summary={summary}>
      <table className="outcome-table">
        <thead>
          <tr>
            <th></th>
            <th style={{ textAlign: "right" }}>Planerat</th>
            <th style={{ textAlign: "right" }}>Verkligt</th>
            <th style={{ textAlign: "right" }}>Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td style={{ textAlign: "right" }} className="muted">
                {r.planned}
              </td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{r.actual}</td>
              <td
                style={{
                  textAlign: "right",
                  color:
                    r.diff == null
                      ? "var(--muted)"
                      : r.money
                      ? r.diff > 0
                        ? "var(--red)"
                        : "var(--green)"
                      : "var(--muted)",
                }}
              >
                {r.diff == null
                  ? "–"
                  : r.money
                  ? `${r.diff > 0 ? "+" : ""}${formatKr(r.diff)}`
                  : `${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)} ${r.unit}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}

function Countries({ countries }) {
  const [selected, setSelected] = useState(countries[0]?.code || null);
  const country = countries.find((c) => c.code === selected) || countries[0];

  const summary = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      {countries.slice(0, 8).map((c) => (
        <Flag key={c.code} code={c.code} height={14} />
      ))}
      <span style={{ marginLeft: 2 }}>{countries.length} länder</span>
    </span>
  );

  return (
    <Collapsible title="Länder på resan" summary={summary}>
      <div className="row" style={{ marginBottom: 16 }}>
        {countries.map((c) => (
          <button
            key={c.code}
            className={`country-chip ${c.code === selected ? "active" : ""}`}
            onClick={() => setSelected(c.code)}
          >
            <Flag code={c.code} height={16} />
            {c.name}
            <span style={{ opacity: 0.7 }}>{c.percent}%</span>
          </button>
        ))}
      </div>

      {country && (
        <div className="kpi-grid">
          <Kpi label="Sträcka i landet" value={`${country.km} km`} />
          <Kpi label="Andel av resan" value={`${country.percent}%`} />
          <Kpi label="Etapper" value={country.stage_count} />
          <Kpi label="Stigning" value={`${country.ascent_m} m`} icon="mountain" />
        </div>
      )}
    </Collapsible>
  );
}

function Calories({ stats, onEdit }) {
  const kcal = (n) => `${Math.round(n).toLocaleString("sv-SE")} kcal`;
  const summary = stats.has_calorie_profile ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Icon name="flame" size={14} tone="pink" />
      {kcal(stats.total_cycling_calories)} på cykeln
    </span>
  ) : (
    "Fyll i din cyklistprofil"
  );

  return (
    <Collapsible title="Kalorier" summary={summary}>
      {!stats.has_calorie_profile ? (
        <div className="row space-between">
          <span className="muted">
            Fyll i din cyklistprofil (minst vikt) så räknar vi ut förbränningen.
          </span>
          <button className="btn-secondary btn-sm" onClick={onEdit}>
            Fyll i profil
          </button>
        </div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Förbränt på cykeln (hela resan)"
              value={kcal(stats.total_cycling_calories)}
              icon="bike"
            />
            <Kpi
              label="Snitt på cykeln / cykeldag"
              value={kcal(stats.avg_cycling_calories_per_cycling_day)}
            />
            {stats.total_calories != null ? (
              <>
                <Kpi
                  label="Total förbränning (hela resan)"
                  value={kcal(stats.total_calories)}
                />
                <Kpi label="Basförbränning (BMR/dygn)" value={kcal(stats.bmr)} />
              </>
            ) : (
              <Kpi
                label="Total dagsförbränning"
                value="Fyll i längd, ålder & kön"
              />
            )}
          </div>
          {stats.total_calories == null && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              Komplettera profilen under <em>Redigera</em> för att även se total
              dagsförbränning (BMR + cykling).
            </p>
          )}
        </>
      )}
    </Collapsible>
  );
}

function Kpi({ label, value, icon }) {
  return (
    <div className="kpi">
      <div className="kpi-value" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {icon && <Icon name={icon} size={17} />}
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function EditProjectModal({ project, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: project.title,
    budget: project.budget,
    start_date: project.start_date,
    end_date: project.end_date,
    rider_gender: project.rider_gender || "",
    rider_age: project.rider_age ?? "",
    rider_height_cm: project.rider_height_cm ?? "",
    rider_weight_kg: project.rider_weight_kg ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    if (form.end_date < form.start_date) {
      setError("Slutdatum måste vara samma eller efter startdatum.");
      return;
    }
    setBusy(true);
    // Tomma siffervärden ska skickas som null, inte "".
    const numOrNull = (v) => (v === "" || v === null ? null : Number(v));
    const payload = {
      ...form,
      rider_age: numOrNull(form.rider_age),
      rider_height_cm: numOrNull(form.rider_height_cm),
      rider_weight_kg: numOrNull(form.rider_weight_kg),
    };
    try {
      await api.patch(`/projects/${project.id}/`, payload);
      // Synka dagar mot eventuellt ändrade datum (behåller befintlig data).
      await api.post(`/projects/${project.id}/regenerate_days/`, {});
      toast.success("Semestern uppdaterad");
      onSaved();
    } catch (err) {
      setError(err.message || "Kunde inte spara");
      setBusy(false);
    }
  }

  return (
    <Modal title="Redigera semester" onClose={onClose} maxWidth={520}>
      <form onSubmit={save}>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Titel</label>
          <input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            required
          />
        </div>
        <div className="grid grid-3">
          <div className="field">
            <label>Budget (kr)</label>
            <input
              type="number"
              min="0"
              value={form.budget}
              onChange={(e) => update("budget", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Startdatum</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => update("start_date", e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Slutdatum</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => update("end_date", e.target.value)}
              required
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Ändrade datum lägger till/tar bort dagar utan att röra befintlig
          planering inom intervallet.
        </p>

        <h3 style={{ margin: "18px 0 4px" }}>Cyklistprofil (för kalorier)</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Vikt räcker för cykelförbränning. Fyll i allt för total
          dagsförbränning (BMR).
        </p>
        <div className="grid grid-3">
          <div className="field">
            <label>Vikt (kg)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.rider_weight_kg}
              onChange={(e) => update("rider_weight_kg", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Längd (cm)</label>
            <input
              type="number"
              min="0"
              value={form.rider_height_cm}
              onChange={(e) => update("rider_height_cm", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Ålder</label>
            <input
              type="number"
              min="0"
              value={form.rider_age}
              onChange={(e) => update("rider_age", e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>Kön</label>
          <select
            value={form.rider_gender}
            onChange={(e) => update("rider_gender", e.target.value)}
          >
            <option value="">– välj –</option>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Sparar…" : "Spara"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ISO-veckonummer för ett "YYYY-MM-DD"-datum.
function isoWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((date - firstThursday) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    )
  );
}

function fmtShort(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
  });
}

function dayRoute(day) {
  if (day.is_rest_day) return null;
  const st = day.stages || [];
  if (!st.length) return null;
  return {
    from: st[0].from_point || "?",
    fromCountry: st[0].from_country || "",
    to: st[st.length - 1].to_point || "?",
    toCountry: st[st.length - 1].to_country || "",
    stops: st.length,
  };
}

function DayList({ days, budgetByDay, hasCalorieProfile, onOpen }) {
  // Gruppera dagarna per ISO-vecka.
  const groups = [];
  let cur = null;
  for (const day of days) {
    const wk = isoWeek(day.date);
    if (!cur || cur.week !== wk) {
      cur = { week: wk, days: [] };
      groups.push(cur);
    }
    cur.days.push(day);
  }

  return (
    <div className="day-list">
      {groups.map((g) => (
        <div key={`${g.week}-${g.days[0].date}`} className="week-group">
          <div className="week-header">
            <span className="week-num">Vecka {g.week}</span>
            <span className="muted">
              {fmtShort(g.days[0].date)} – {fmtShort(g.days[g.days.length - 1].date)}
            </span>
          </div>
          {g.days.map((day) => (
            <DayRow
              key={day.id}
              day={day}
              budget={budgetByDay[day.id]}
              hasCalorieProfile={hasCalorieProfile}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function DayRow({ day, budget, hasCalorieProfile, onOpen }) {
  const route = dayRoute(day);
  const duration = (day.stages || []).reduce(
    (sum, st) => sum + (st.estimated_duration_minutes || 0),
    0
  );
  const acc = accommodationLabel(day.accommodation_type);
  const over = budget && budget.over_budget;
  const actualCost = Number(day.actual_cost || 0);
  const hasActual =
    day.actual_distance_km > 0 ||
    actualCost > 0 ||
    day.actual_duration_minutes > 0;

  const d = new Date(day.date + "T00:00:00");
  const wd = (day.weekday || "").slice(0, 3);
  const dayNum = d.getDate();
  const month = d
    .toLocaleDateString("sv-SE", { month: "short" })
    .replace(".", "");

  const actualParts = [];
  if (day.actual_distance_km > 0) actualParts.push(`${day.actual_distance_km} km`);
  if (day.actual_duration_minutes > 0)
    actualParts.push(formatMinutes(day.actual_duration_minutes));
  if (actualCost > 0) actualParts.push(formatKr(actualCost));

  return (
    <div
      className={`daycard ${day.is_rest_day ? "is-rest" : ""}`}
      onClick={() => onOpen(day)}
    >
      <div className="daycard-main">
        <div className="dc-date">
          <span className="dc-wd">{wd}</span>
          <span className="dc-num">{dayNum}</span>
          <span className="dc-mo">{month}</span>
        </div>

        <div className="dc-body">
          <div className="dc-route">
            {day.is_rest_day ? (
              <><Icon name="bed" size={15} /> Vilodag</>
            ) : route ? (
              <>
                {route.fromCountry && (
                  <Flag code={route.fromCountry} height={11} />
                )}{" "}
                {route.from} <span className="muted">→</span>{" "}
                {route.toCountry && <Flag code={route.toCountry} height={11} />}{" "}
                {route.to}
              </>
            ) : (
              <span className="muted" style={{ fontWeight: 400 }}>
                Ingen rutt än
              </span>
            )}
          </div>
          <div className="dc-meta">
            {!day.is_rest_day && day.distance_km > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="ruler" size={13} /> {day.distance_km} km
              </span>
            )}
            {duration > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="clock" size={13} /> {formatMinutes(duration)}
              </span>
            )}
            {route?.stops > 1 && <span className="hide-mobile">{route.stops} etapper</span>}
            {acc !== "–" && (
              <span className="hide-mobile" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="bed" size={13} /> {acc}
              </span>
            )}
            {!day.is_rest_day &&
              !day.distance_km &&
              !duration &&
              acc === "–" && <span className="muted">Ej planerad</span>}
          </div>
        </div>

        <div className="dc-end">
          <span className={over ? "badge badge-red" : "badge badge-green"}>
            {formatKr(day.total_cost)}
          </span>
          {budget && <span className="dc-budget muted">/ {formatKr(budget.budget)}</span>}
        </div>
      </div>

      {hasActual && (
        <div className="dc-actual">
          <span className="actual-tag">Verkligt</span> {actualParts.join(" · ")}
        </div>
      )}
    </div>
  );
}

function accommodationLabel(type) {
  const map = {
    VILDCAMP: "Vildcamping",
    CAMPING: "Camping",
    HOTELL: "Hotell",
    VANDRARHEM: "Vandrarhem",
    VANNER: "Hos vänner",
  };
  return map[type] || "–";
}
