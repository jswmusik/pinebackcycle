// Delade etiketter och val som speglar backendens modeller.

export const COST_CATEGORIES = [
  { value: "RESA", label: "Resa" },
  { value: "BOENDE", label: "Boende" },
  { value: "SERVICE", label: "Service" },
  { value: "NOJE", label: "Nöje" },
  { value: "FRUKOST", label: "Frukost" },
  { value: "LUNCH", label: "Lunch" },
  { value: "MIDDAG", label: "Middag" },
  { value: "KVALLSMAT", label: "Kvällsmat" },
  { value: "MELLANMAL", label: "Mellanmål" },
  { value: "DRICKA", label: "Dricka" },
];

export const ACCOMMODATION_TYPES = [
  { value: "VILDCAMP", label: "Vildcamping (gratis)", free: true },
  { value: "CAMPING", label: "Camping (betald)", free: false },
  { value: "HOTELL", label: "Hotell (betald)", free: false },
  { value: "VANDRARHEM", label: "Vandrarhem (betald)", free: false },
  { value: "VANNER", label: "Hos vänner (gratis)", free: true },
];

// Kön för kaloriprofilen (matchar Project.Gender i backend).
export const GENDERS = [
  { value: "M", label: "Man" },
  { value: "F", label: "Kvinna" },
  { value: "O", label: "Annat / vill ej ange" },
];

// Cykelprofiler (matchar ORS-profilerna i backend).
export const CYCLING_PROFILES = [
  { value: "regular", label: "Vanlig cykel" },
  { value: "road", label: "Landsväg" },
  { value: "mountain", label: "Mountainbike" },
  { value: "electric", label: "Elcykel" },
];

// Svårighetsnivå 0-6 -> beskrivning + snitthastighet.
export const DIFFICULTY = {
  0: { label: "Platt", speed: 20 },
  1: { label: "Lätt", speed: 18 },
  2: { label: "Lätt-medel", speed: 16 },
  3: { label: "Medel", speed: 14 },
  4: { label: "Medel-tung", speed: 12 },
  5: { label: "Tung", speed: 10 },
  6: { label: "Mycket tung", speed: 8 },
};

export function formatKr(value) {
  const num = Number(value || 0);
  return num.toLocaleString("sv-SE", { maximumFractionDigits: 0 }) + " kr";
}

export function formatMinutes(min) {
  const m = Math.round(min || 0);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return `${h} h ${rest} min`;
}
