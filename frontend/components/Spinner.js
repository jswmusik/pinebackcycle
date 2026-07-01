"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

// Liten lekfull laddningsindikator: en rullande cykel.
export default function Spinner({ label = "Laddar…" }) {
  // Om laddningen drar ut på tiden (t.ex. en ovanlig kallstart) visar vi en
  // lugnande förklaring i stället för att bara snurra tyst.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="spinner-wrap">
      <div className="spinner-bike" aria-hidden>
        <Icon name="bike" size={40} tone="pink" strokeWidth={1.75} />
      </div>
      <div className="spinner-track" />
      {label && <div className="spinner-label muted">{label}</div>}
      {slow && (
        <div className="spinner-label muted" style={{ fontSize: 12, opacity: 0.75 }}>
          Startar servern – ett ögonblick…
        </div>
      )}
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
