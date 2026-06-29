// Hämtar boende-POI:er från OpenStreetMap via Overpass API (gratis, ingen nyckel).
// Söker camping, ställplats (husbil), vandrarhem och hotell i en kartruta.

// Flera speglar – vi provar i tur och ordning om någon är nere/begränsad.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// OSM tourism-tagg -> vår boendetyp + etikett.
export const POI_TYPES = {
  camp_site: { label: "Camping", accommodation: "CAMPING", icon: "🏕️" },
  caravan_site: { label: "Ställplats", accommodation: "CAMPING", icon: "🚐" },
  hostel: { label: "Vandrarhem", accommodation: "VANDRARHEM", icon: "🛏️" },
  hotel: { label: "Hotell", accommodation: "HOTELL", icon: "🏨" },
};

// bounds: Leaflet LatLngBounds. Returnerar lista av POI:er.
// Max sökyta i grader (~70 km). Större kartvyer kapas till mitten så att
// Overpass-frågan alltid blir snabb (annars timeout/504 vid utzoomning).
const MAX_SPAN_DEG = 0.7;

export async function findAccommodation(bounds) {
  let s = bounds.getSouth();
  let w = bounds.getWest();
  let n = bounds.getNorth();
  let e = bounds.getEast();

  // Kapa till en centrerad ruta om vyn är väldigt stor.
  const latC = (s + n) / 2;
  const lngC = (w + e) / 2;
  let clamped = false;
  if (n - s > MAX_SPAN_DEG) {
    s = latC - MAX_SPAN_DEG / 2;
    n = latC + MAX_SPAN_DEG / 2;
    clamped = true;
  }
  if (e - w > MAX_SPAN_DEG) {
    w = lngC - MAX_SPAN_DEG / 2;
    e = lngC + MAX_SPAN_DEG / 2;
    clamped = true;
  }

  const bbox = `${s},${w},${n},${e}`;
  const filter = Object.keys(POI_TYPES).join("|");

  const query = `
    [out:json][timeout:15];
    (
      node["tourism"~"${filter}"](${bbox});
      way["tourism"~"${filter}"](${bbox});
    );
    out center 60;
  `;

  // Fråga alla speglar samtidigt och använd det första giltiga svaret.
  // En gemensam timeout gör att inget hänger om en server är trög.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);

  async function ask(url) {
    const res = await fetch(url, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("status " + res.status);
    return res.json();
  }

  let data = null;
  try {
    data = await Promise.any(OVERPASS_MIRRORS.map(ask));
  } catch {
    throw new Error(
      "Sökningen tog för lång tid eller misslyckades. Försök igen, " +
        "eller zooma in lite för ett mindre område."
    );
  } finally {
    clearTimeout(timer);
    controller.abort(); // avbryt övriga speglar som fortfarande svarar
  }
  const pois = (data.elements || [])
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) return null;
      const tourism = el.tags?.tourism;
      const meta = POI_TYPES[tourism];
      if (!meta) return null;
      return {
        id: `${el.type}/${el.id}`,
        osmType: el.type,
        osmId: el.id,
        lat,
        lng,
        name: el.tags?.name || meta.label,
        tourism,
        meta,
        website: el.tags?.website || el.tags?.["contact:website"] || "",
      };
    })
    .filter(Boolean);
  return { pois, clamped };
}

export function osmUrl(poi) {
  return `https://www.openstreetmap.org/${poi.osmType}/${poi.osmId}`;
}
