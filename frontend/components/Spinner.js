"use client";

import Icon from "@/components/Icon";

// Liten lekfull laddningsindikator: en rullande cykel.
export default function Spinner({ label = "Laddar…" }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner-bike" aria-hidden>
        <Icon name="bike" size={40} tone="pink" strokeWidth={1.75} />
      </div>
      <div className="spinner-track" />
      {label && <div className="spinner-label muted">{label}</div>}
    </div>
  );
}

export function FullScreenSpinner({ label }) {
  return (
    <div className="center-screen">
      <Spinner label={label} />
    </div>
  );
}
