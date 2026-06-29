// Geokodning via OpenStreetMap Nominatim (gratis, ingen nyckel).
// Returnerar [lng, lat] för bästa träff, eller null.
// OBS: Nominatim tillåter max ~1 anrop/sekund – använd sparsamt.

export async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Sökningen misslyckades");
  const data = await res.json();
  if (!data.length) return null;
  return {
    point: [parseFloat(data[0].lon), parseFloat(data[0].lat)],
    label: data[0].display_name,
  };
}
