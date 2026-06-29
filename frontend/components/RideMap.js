"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";

const toLatLng = (p) => [p[1], p[0]];

// Pulserande GPS-prick för din position.
const positionIcon = L.divIcon({
  className: "gps-marker",
  html: '<div class="gps-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function Follower({ position, follow }) {
  const map = useMap();
  useEffect(() => {
    if (follow && position) {
      map.setView(position, Math.max(map.getZoom(), 14), { animate: true });
    }
  }, [position, follow, map]);
  return null;
}

function FitRouteOnce({ allPoints, hasPosition }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || hasPosition || !allPoints.length) return;
    done.current = true;
    if (allPoints.length === 1) map.setView(allPoints[0], 13);
    else map.fitBounds(allPoints, { padding: [30, 30] });
  }, [allPoints, hasPosition, map]);
  return null;
}

export default function RideMap({
  geometries = [],
  track = [],
  position = null,
  follow = true,
  height = "100%",
}) {
  const lines = geometries
    .filter((g) => g?.coordinates?.length)
    .map((g) => g.coordinates.map(toLatLng));
  const trackLine = track.map(toLatLng);
  const allPoints = lines.flat();
  const center = position || trackLine[trackLine.length - 1] || allPoints[0] || [60.13, 15.0];

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap-bidragsgivare"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitRouteOnce allPoints={allPoints} hasPosition={!!position} />
        <Follower position={position} follow={follow} />
        {/* Planerad rutt = navigeringslinjen att följa */}
        {lines.map((line, i) => (
          <Polyline
            key={i}
            positions={line}
            pathOptions={{ color: "#8b5cf6", weight: 6, opacity: 0.9 }}
          />
        ))}
        {/* Din faktiska väg */}
        {trackLine.length > 1 && (
          <Polyline
            positions={trackLine}
            pathOptions={{ color: "#ec4899", weight: 4, opacity: 0.95 }}
          />
        )}
        {position && <Marker position={position} icon={positionIcon} />}
      </MapContainer>

      {lines.length > 0 && (
        <div className="ride-legend">
          <span><i className="leg-nav" /> Planerad rutt</span>
          {trackLine.length > 1 && <span><i className="leg-you" /> Din väg</span>}
        </div>
      )}
    </div>
  );
}
