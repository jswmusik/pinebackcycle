"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { formatKr } from "@/lib/constants";
import { useToast, useConfirm } from "@/components/Providers";
import TopBar from "@/components/TopBar";
import { FullScreenSpinner } from "@/components/Spinner";
import Icon from "@/components/Icon";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const [projects, setProjects] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (user) {
      api.get("/projects/").then(setProjects).catch(() => {});
    }
  }, [user]);

  async function deleteProject(e, p) {
    // Hindra kortets navigering när man klickar på papperskorgen.
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: "Radera cykelsemester?",
      message: `"${p.title}" och all dess planering tas bort permanent.`,
      confirmLabel: "Radera",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/projects/${p.id}/`);
      setProjects((list) => list.filter((x) => x.id !== p.id));
      toast.success("Cykelsemester raderad");
    } catch (err) {
      toast.error(err.message || "Kunde inte radera");
    }
  }

  if (loading || !user) {
    return <FullScreenSpinner label="Laddar dina semestrar…" />;
  }

  return (
    <>
      <TopBar user={user} />
      <div className="container">
        <div className="row space-between" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Mina cykelsemestrar</h2>
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Avbryt" : "+ Skapa cykelsemester"}
          </button>
        </div>

        {showForm && (
          <NewProjectForm
            onCreated={(p) => {
              setShowForm(false);
              toast.success("Cykelsemester skapad");
              router.push(`/projects/${p.id}`);
            }}
          />
        )}

        {projects.length === 0 ? (
          <p className="muted">Inga semestrar än. Skapa din första!</p>
        ) : (
          <div className="grid grid-3">
            {projects.map((p) => (
              <div
                key={p.id}
                className="card card-hover"
                onClick={() => router.push(`/projects/${p.id}`)}
                style={{ position: "relative", cursor: "pointer", color: "inherit" }}
              >
                <button
                  className="card-del"
                  onClick={(e) => deleteProject(e, p)}
                  aria-label="Radera cykelsemester"
                  title="Radera"
                >
                  <Icon name="trash" size={16} />
                </button>
                <h3 style={{ marginTop: 0, paddingRight: 30 }}>{p.title}</h3>
                <p className="muted" style={{ margin: "4px 0" }}>
                  {p.start_date} – {p.end_date} · {p.day_count} dagar
                </p>
                <div className="row space-between" style={{ marginTop: 12 }}>
                  <span>
                    <strong>{p.total_distance_km}</strong> km
                  </span>
                  <span>
                    {formatKr(p.total_cost)} / {formatKr(p.budget)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function NewProjectForm({ onCreated }) {
  const [form, setForm] = useState({
    title: "",
    budget: "",
    start_date: "",
    end_date: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (form.end_date < form.start_date) {
      setError("Slutdatum måste vara samma eller efter startdatum.");
      return;
    }
    setBusy(true);
    try {
      const created = await api.post("/projects/", {
        title: form.title,
        budget: form.budget || 0,
        start_date: form.start_date,
        end_date: form.end_date,
      });
      onCreated(created);
    } catch (err) {
      setError(err.message || "Kunde inte skapa.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Skapa cykelsemester</h3>
      {error && <div className="error">{error}</div>}
      <div className="field">
        <label>Titel</label>
        <input
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="t.ex. Vätterrundan 2026"
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
      <button type="submit" disabled={busy}>
        {busy ? "Skapar…" : "Skapa"}
      </button>
    </form>
  );
}
