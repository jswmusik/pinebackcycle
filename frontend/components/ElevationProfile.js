"use client";

// Ritar en höjdprofil som SVG-yta utifrån ruttens geometri.
// route_geometry.coordinates är [lng, lat, ele] (ORS med elevation=true).

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function ElevationProfile({ geometry, height = 130 }) {
  const coords = geometry?.coordinates || [];
  const hasElevation = coords.length > 1 && coords[0].length >= 3;
  if (!hasElevation) return null;

  // Bygg (distans, höjd)-punkter.
  let dist = 0;
  const pts = coords.map((c, i) => {
    if (i > 0) dist += haversineKm(coords[i - 1], c);
    return { x: dist, y: c[2] };
  });

  const W = 760;
  const H = height;
  const pad = { top: 14, right: 12, bottom: 22, left: 40 };
  const maxX = pts[pts.length - 1].x || 1;
  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;

  const sx = (x) => pad.left + (x / maxX) * (W - pad.left - pad.right);
  const sy = (y) =>
    pad.top + (1 - (y - minY) / spanY) * (H - pad.top - pad.bottom);

  const line = pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
  const area =
    `${sx(0)},${H - pad.bottom} ` +
    line +
    ` ${sx(maxX)},${H - pad.bottom}`;

  // Stigning/fall.
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (d > 0) ascent += d;
    else descent -= d;
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 0 }}>
      <div className="row space-between" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 14 }}>Höjdprofil</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          ↑ {Math.round(ascent)} m · ↓ {Math.round(descent)} m ·{" "}
          {Math.round(minY)}–{Math.round(maxY)} m ö.h.
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* Y-axel-etiketter */}
        {[maxY, (maxY + minY) / 2, minY].map((val, i) => {
          const y = sy(val);
          return (
            <g key={i}>
              <line
                x1={pad.left}
                y1={y}
                x2={W - pad.right}
                y2={y}
                stroke="#e3e8e7"
                strokeWidth="1"
              />
              <text
                x={pad.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#6b7c79"
              >
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* X-axel-etiketter (km) */}
        {[0, maxX / 2, maxX].map((val, i) => (
          <text
            key={i}
            x={sx(val)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            fontSize="10"
            fill="#6b7c79"
          >
            {val.toFixed(1)} km
          </text>
        ))}

        <polygon points={area} fill="url(#elevFill)" />
        <polyline
          points={line}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
