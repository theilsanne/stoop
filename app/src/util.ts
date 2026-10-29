export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export const money = (n: number | null | undefined) => (n == null ? "–" : "$" + Math.round(n).toLocaleString("en-US"));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Dec 1" this year or next, "Dec 1, 2025" otherwise. Takes YYYY-MM-DD. */
export function fmtDate(d: string | null | undefined) {
  if (!d) return "–";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const now = new Date().getFullYear();
  return `${MONTHS[m - 1]} ${day}${y === now || y === now + 1 ? "" : ", " + y}`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const h = (Date.now() - Date.parse(iso)) / 3600e3;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + "m ago";
  if (h < 24) return Math.round(h) + "h ago";
  const d = Math.round(h / 24);
  return d < 60 ? d + "d ago" : Math.round(d / 30) + "mo ago";
}

export const beds = (n: number | null) => (n == null ? "–" : n === 0 ? "Studio" : `${n} bd`);

export const clone = <T>(x: T): T => structuredClone(x);

export function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem("stoop." + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem("stoop." + key, JSON.stringify(v)); } catch { /* private mode */ }
}

// Official MTA trunk-line colors, keyed by route letter/number.
export const LINE_COLORS: Record<string, string> = {
  A: "#0039A6", C: "#0039A6", E: "#0039A6",
  B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319",
  G: "#6CBE45",
  J: "#996633", Z: "#996633",
  L: "#A7A9AC",
  N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A",
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  S: "#808183",
};

/** A subway line as its round colored bullet, e.g. the blue A. Express variants (6X) use their line's color. */
export function bullet(line: string) {
  const base = line.replace(/X$/, "");
  const bg = LINE_COLORS[base] ?? "#808183";
  const dark = ["N", "Q", "R", "W"].includes(base);
  return `<span class="bullet" style="background:${bg};color:${dark ? "#111" : "#fff"}" role="img" aria-label="${esc(line)} train">${esc(base)}</span>`;
}

/** "Walk 7 → A → C → Walk 2" as bullets with the walks in between: 7 min walk · (A)(C) · 2 min walk. */
export function routeHTML(route: string) {
  return route.split(" → ").map((part) => {
    const w = part.match(/^Walk (\d+)$/);
    return w ? `<span class="walk">${w[1]} min walk</span>` : bullet(part);
  }).join('<span class="sep" aria-hidden="true">›</span>');
}

/** Google Maps for a listing, to open in a new tab. By address when it has one, since the scraped pin can be a little off. */
export function googleMapsUrl(row: { address: string | null; neighborhood: string | null; lat: number | null; lng: number | null }) {
  const query = row.address ? [row.address, row.neighborhood, "NY"].filter(Boolean).join(", ")
    : row.lat != null && row.lng != null ? `${row.lat},${row.lng}` : null;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
