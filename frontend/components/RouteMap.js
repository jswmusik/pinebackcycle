"use client";

import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { findAccommodation, osmUrl } from "@/lib/overpass";
import { useToast } from "@/components/Providers";

// Leaflets standardikoner går sönder i bundlers – peka mot CDN-bilder.
const icon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Boende-POI:er får en emoji-markör.
function poiIcon(emoji) {
  return L.divIcon({
    className: "poi-marker",
    html: `<div class="poi-pin"><span>${emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

const toLatLng = (p) => [p[1], p[0]];

function ClickHandler({ onAdd }) {
  useMapEvents({
    click(e) {
      onAdd([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(toLatLng(points[0]), 12);
    else map.fitBounds(points.map(toLatLng), { padding: [40, 40] });
  }, [points, map]);
  return null;
}

// Fångar Leaflet-kartan så söklogiken kan läsa nuvarande vy.
function MapRef({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

export default function RouteMap({
  waypoints = [],
  routeGeometry = null,
  track = [],
  onChange,
  editable = true,
  onUseAsAccommodation = null,
}) {
  const toast = useToast();
  const [map, setMap] = useState(null);
  const [pois, setPois] = useState([]);
  const [searching, setSearching] = useState(false);

  const center = waypoints.length ? toLatLng(waypoints[0]) : [60.13, 15.0];

  function addPoint(p) {
    if (!editable) return;
    onChange([...waypoints, p]);
  }

  function removePoint(index) {
    if (!editable) return;
    onChange(waypoints.filter((_, i) => i !== index));
  }

  async function searchAccommodation() {
    if (!map) return;
    setSearching(true);
    try {
      const { pois: found, clamped } = await findAccommodation(map.getBounds());
      setPois(found);
      if (!found.length) {
        toast.info("Inga boenden hittades här – flytta kartan och sök igen");
      } else if (clamped) {
        toast.success(
          `Hittade ${found.length} boenden nära kartans mitt (zooma in för annat område)`
        );
      } else {
        toast.success(`Hittade ${found.length} boenden i kartvyn`);
      }
    } catch (e) {
      toast.error(e.message || "Sökningen misslyckades");
    } finally {
      setSearching(false);
    }
  }

  const line =
    routeGeometry?.coordinates?.map(toLatLng) || waypoints.map(toLatLng);
  const trackLine = (track || []).map(toLatLng);

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 1000,
          display: "flex",
          gap: 6,
        }}
      >
        <button
          className="btn-sm"
          onClick={searchAccommodation}
          disabled={searching}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
        >
          {searching ? "Söker…" : "🏕️ Hitta boenden här"}
        </button>
        {pois.length > 0 && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPois([])}
            style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            Rensa
          </button>
        )}
      </div>

      <MapContainer
        center={center}
        zoom={9}
        style={{ height: 420, width: "100%", borderRadius: 12 }}
        scrollWheelZoom
      >
        <TileLayer
          attribution="&copy; OpenStreetMap-bidragsgivare"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapRef onReady={setMap} />
        {editable && <ClickHandler onAdd={addPoint} />}
        <FitBounds points={waypoints} />

        {waypoints.map((p, i) => (
          <Marker
            key={`wp-${i}`}
            position={toLatLng(p)}
            icon={icon}
            eventHandlers={{ click: () => removePoint(i) }}
          >
            {editable && (
              <Tooltip direction="top" offset={[0, -36]}>
                {i === 0
                  ? "Start"
                  : i === waypoints.length - 1
                  ? "Mål"
                  : `Stopp ${i}`}{" "}
                · klicka för att ta bort
              </Tooltip>
            )}
          </Marker>
        ))}
        {line.length > 1 && (
          <Polyline
            positions={line}
            pathOptions={{
              color: "#8b5cf6",
              weight: 4,
              opacity: trackLine.length > 1 ? 0.6 : 1,
            }}
          />
        )}
        {trackLine.length > 1 && (
          <Polyline
            positions={trackLine}
            pathOptions={{ color: "#ec4899", weight: 4, opacity: 0.95 }}
          />
        )}

        {pois.map((poi) => (
          <Marker
            key={poi.id}
            position={[poi.lat, poi.lng]}
            icon={poiIcon(poi.meta.icon)}
          >
            <Popup>
              <div style={{ minWidth: 170 }}>
                <strong>{poi.name}</strong>
                <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>
                  {poi.meta.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    className="btn-sm"
                    onClick={() => {
                      addPoint([poi.lng, poi.lat]);
                      toast.success("Lade till på rutten");
                    }}
                  >
                    Lägg till på rutten
                  </button>
                  {onUseAsAccommodation && (
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => onUseAsAccommodation(poi)}
                    >
                      Använd som boende
                    </button>
                  )}
                  <a
                    href={poi.website || osmUrl(poi)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13 }}
                  >
                    Mer info ↗
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {trackLine.length > 1 && (
        <div className="ride-legend" style={{ top: "auto", bottom: 10 }}>
          <span><i className="leg-nav" /> Planerad rutt</span>
          <span><i className="leg-you" /> Verklig rutt</span>
        </div>
      )}
    </div>
  );
}
