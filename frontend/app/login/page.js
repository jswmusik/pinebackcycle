"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, ensureCsrf } from "@/lib/api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await ensureCsrf();
      await auth.login(username, password);
      router.push("/");
    } catch (err) {
      setError(err.message || "Inloggning misslyckades.");
      setBusy(false);
    }
  }

  return (
    <div className="center-screen login-bg">
      <div className="login-card">
        <div className="login-logo">🚲</div>
        <h2 style={{ textAlign: "center", margin: "0 0 2px" }}>Pineback</h2>
        <p
          className="muted"
          style={{ textAlign: "center", margin: "0 0 22px" }}
        >
          Planera din cykelsemester
        </p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Användarnamn</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label>Lösenord</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "Loggar in…" : "Logga in"}
          </button>
        </form>
      </div>
    </div>
  );
}
