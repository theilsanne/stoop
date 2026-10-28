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

/** "Noah Semus" → "NS", "noah" → "N". Stands in for a profile photo. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0][0];
  return letters.toUpperCase();
}

/** A color for someone without a photo, the same every time: from their id. */
export const hueOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

export const clone = <T>(x: T): T => structuredClone(x);

export function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem("stoop." + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem("stoop." + key, JSON.stringify(v)); } catch { /* private mode */ }
}
