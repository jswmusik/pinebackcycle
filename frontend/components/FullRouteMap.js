"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";

const toLatLng = (p) => [p[1], p[0]];

function FitAll({ allPoints }) {
  const map = useMap();
  useEffect(() => {
    if (allPoints.length === 0) return;
    if (allPoints.length === 1) map.setView(allPoints[0], 11);
    else map.fitBounds(allPoints, { padding: [30, 30] });
  }, [allPoints, map]);
  return null;
}

// Låser zoom/panorering tills Ctrl (eller ⌘) hålls nere – så att man inte
// råkar zooma/flytta kartan när man bara scrollar förbi på sidan.
function GestureLock() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();
    map.dragging.disable();

    const enable = (e) => {
      if (e.key === "Control" || e.key === "Meta") {
        map.scrollWheelZoom.enable();
        map.dragging.enable();
      }
    };
    const disable = (e) => {
      if (e.key === "Control" || e.key === "Meta") {
        map.scrollWheelZoom.disable();
        map.dragging.disable();
      }
    };
    const relock = () => {
      map.scrollWheelZoom.disable();
      map.dragging.disable();
    };

    document.addEventListener("keydown", enable);
    document.addEventListener("keyup", disable);
    window.addEventListener("blur", relock);
    return () => {
      document.removeEventListener("keydown", enable);
      document.removeEventListener("keyup", disable);
      window.removeEventListener("blur", relock);
    };
  }, [map]);
  return null;
}

// Visar hela resans rutt – planerad (teal) och verklig/inspelad (röd).
export default function FullRouteMap({ geometries = [], tracks = [], height = 380 }) {
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(null);

  const lines = geometries
    .filter((g) => g?.coordinates?.length)
    .map((g) => g.coordinates.map(toLatLng));

  const trackLines = tracks
    .filter((t) => t?.length > 1)
    .map((t) => t.map(toLatLng));

  const allPoints = [...lines.flat(), ...trackLines.flat()];

  if (allPoints.length === 0) {
    return (
      <div className="muted" style={{ padding: 20, textAlign: "center" }}>
        Ingen beräknad rutt än. Beräkna etapper för att se hela resan på kartan.
      </div>
    );
  }

  // Visa en hjälptext om man scrollar över kartan utan Ctrl.
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) {
      setHint(true);
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), 1400);
    }
  }

  return (
    <div style={{ position: "relative" }} onWheel={onWheel}>
      <MapContainer
        center={allPoints[0]}
        zoom={9}
        style={{ height, width: "100%", borderRadius: 12 }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap-bidragsgivare"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GestureLock />
        <FitAll allPoints={allPoints} />
        {lines.map((line, i) => (
          <Polyline
            key={`p-${i}`}
            positions={line}
            pathOptions={{
              color: "#8b5cf6",
              weight: 4,
              opacity: trackLines.length ? 0.5 : 0.85,
            }}
          />
        ))}
        {trackLines.map((line, i) => (
          <Polyline
            key={`a-${i}`}
            positions={line}
            pathOptions={{ color: "#ec4899", weight: 4, opacity: 0.95 }}
          />
        ))}
      </MapContainer>

      {trackLines.length > 0 && (
        <div className="map-legend">
          <span><i className="leg-plan" /> Planerat</span>
          <span><i className="leg-actual" /> Verkligt</span>
        </div>
      )}

      {hint && (
        <div className="map-hint">
          Håll <kbd>Ctrl</kbd> och scrolla för att zooma · dra för att flytta
        </div>
      )}
    </div>
  );
}
