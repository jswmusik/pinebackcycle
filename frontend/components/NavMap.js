"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";

const toLatLng = (p) => [p[1], p[0]];

// Riktningspil för din position.
function arrowIcon(heading) {
  const h = heading == null ? 0 : heading;
  return L.divIcon({
    className: "nav-pos-marker",
    html: `<div class="nav-arrow" style="transform:rotate(${h}deg)"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const maneuverDot = L.divIcon({
  className: "nav-maneuver-marker",
  html: '<div class="nav-maneuver-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function Follow({ position, active }) {
  const map = useMap();
  useEffect(() => {
    if (active && position) {
      map.setView(position, Math.max(map.getZoom(), 16), { animate: true });
    }
  }, [position, active, map]);
  return null;
}

function FitOnce({ line, hasPosition }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || hasPosition || line.length < 2) return;
    done.current = true;
    map.fitBounds(line, { padding: [40, 40] });
  }, [line, hasPosition, map]);
  return null;
}

export default function NavMap({
  coords = [],
  track = [],
  position = null,
  heading = null,
  maneuver = null,
  follow = true,
}) {
  const line = coords.map(toLatLng);
  const trackLine = track.map(toLatLng);
  const center = position || line[0] || [60.13, 15.0];

  return (
    <MapContainer
      center={center}
      zoom={16}
      zoomControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap-bidragsgivare"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitOnce line={line} hasPosition={!!position} />
      <Follow position={position} active={follow} />
      {line.length > 1 && (
        <Polyline
          positions={line}
          pathOptions={{ color: "#8b5cf6", weight: 7, opacity: 0.9 }}
        />
      )}
      {trackLine.length > 1 && (
        <Polyline
          positions={trackLine}
          pathOptions={{ color: "#ec4899", weight: 4, opacity: 0.95 }}
        />
      )}
      {maneuver && <Marker position={maneuver} icon={maneuverDot} />}
      {position && <Marker position={position} icon={arrowIcon(heading)} />}
    </MapContainer>
  );
}
