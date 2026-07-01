"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MapContainer,
  TileLayer,
  LayersControl,
  Marker,
  Polyline,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { findAccommodation, osmUrl } from "@/lib/overpass";
import { formatMinutes } from "@/lib/constants";
import { useToast } from "@/components/Providers";
import Icon from "@/components/Icon";

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

// Anpassar vyn till rutten ENDAST vid första laddningen och när en ny rutt
// (geometry) laddas – inte varje gång man lägger en punkt. Då står kartan
// still medan man klickar ut markörer.
function AutoFit({ points, geometry }) {
  const map = useMap();
  const didInit = useRef(false);
  const prevGeom = useRef(geometry);

  useEffect(() => {
    const fit = (pts) => {
      if (!pts.length) return;
      if (pts.length === 1) map.setView(pts[0], 13);
      else map.fitBounds(pts, { padding: [40, 40] });
    };
    if (!didInit.current) {
      didInit.current = true;
      prevGeom.current = geometry;
      fit(geometry?.coordinates?.map(toLatLng) || points.map(toLatLng));
      return;
    }
    // En ny beräknad/inläst rutt → visa hela den. Nya punkter → rör inte vyn.
    if (geometry && geometry !== prevGeom.current) {
      fit(geometry.coordinates.map(toLatLng));
    }
    prevGeom.current = geometry;
  }, [points, geometry, map]);

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
  onCalculate = null,
  calculating = false,
  canCalculate = false,
  routeStats = null,
}) {
  const toast = useToast();
  const [map, setMap] = useState(null);
  const [pois, setPois] = useState([]);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // När kartan byter storlek (helskärm på/av) måste Leaflet räkna om sina rutor.
  useEffect(() => {
    if (!map) return;
    const t = setTimeout(() => map.invalidateSize(), 260);
    return () => clearTimeout(t);
  }, [expanded, map]);

  // Esc stänger helskärmsläget.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

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

  // Zooma till hela rutten på begäran (knapp) – annars står kartan still.
  function fitToRoute() {
    if (!map) return;
    const pts = routeGeometry?.coordinates?.map(toLatLng) || waypoints.map(toLatLng);
    if (!pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 13);
    else map.fitBounds(pts, { padding: [40, 40] });
  }

  const canFit = waypoints.length > 0 || !!routeGeometry;

  const line =
    routeGeometry?.coordinates?.map(toLatLng) || waypoints.map(toLatLng);
  const trackLine = (track || []).map(toLatLng);

  const content = (
    <div className={`route-map ${expanded ? "is-fullscreen" : ""}`}>
      <div className="map-ctrl map-ctrl-tr">
        <button
          className="btn-secondary btn-sm"
          onClick={() => setExpanded((v) => !v)}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
        >
          {expanded ? (
            <>
              <Icon name="minimize" size={15} /> Stäng
            </>
          ) : (
            <>
              <Icon name="maximize" size={15} /> Större karta
            </>
          )}
        </button>
        <button
          className="btn-secondary btn-sm"
          onClick={fitToRoute}
          disabled={!canFit}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
        >
          <Icon name="scan" size={15} /> Visa hela rutten
        </button>
        <button
          className="btn-sm"
          onClick={searchAccommodation}
          disabled={searching}
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
        >
          {searching ? (
            "Söker…"
          ) : (
            <>
              <Icon name="tent" size={15} /> Hitta boenden här
            </>
          )}
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
        style={{
          height: expanded ? "100%" : 420,
          width: "100%",
          borderRadius: expanded ? 0 : 12,
        }}
        scrollWheelZoom
      >
        <LayersControl position="bottomright">
          <LayersControl.BaseLayer checked name="Karta">
            <TileLayer
              attribution="&copy; OpenStreetMap-bidragsgivare"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellit">
            <TileLayer
              className="tiles-plain"
              attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics m.fl."
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Terräng">
            <TileLayer
              className="tiles-plain"
              attribution="&copy; OpenStreetMap-bidragsgivare, SRTM | Stil: OpenTopoMap (CC-BY-SA)"
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              maxZoom={17}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <MapRef onReady={setMap} />
        {editable && <ClickHandler onAdd={addPoint} />}
        <AutoFit points={waypoints} geometry={routeGeometry} />

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

      {(onCalculate || routeStats) && (
        <div className="map-calc">
          {routeStats && (
            <div className="map-routestats">
              <strong>{routeStats.distance_km} km</strong>
              {routeStats.ascent_m != null && (
                <span>↑ {Math.round(routeStats.ascent_m)} m</span>
              )}
              {routeStats.duration != null && (
                <span>{formatMinutes(routeStats.duration)}</span>
              )}
            </div>
          )}
          {onCalculate && (
          <button
            className="btn map-calc-btn"
            onClick={onCalculate}
            disabled={!canCalculate || calculating}
          >
            {calculating ? (
              "Beräknar…"
            ) : (
              <>
                <Icon name="route" size={17} /> Beräkna rutt ({waypoints.length}{" "}
                punkter)
              </>
            )}
          </button>
          )}
        </div>
      )}
    </div>
  );

  // I helskärmsläge portalas kartan till <body> så den fyller hela fönstret
  // (modalens backdrop-filter gör annars att fixed blir relativ till modalen).
  return expanded && typeof document !== "undefined"
    ? createPortal(content, document.body)
    : content;
}
