// Transit commute times from Transitous (https://transitous.org), a free, open
// public-transit router built on MOTIS. No account or key.
//
// Usage policy (transitous.org/api): non-commercial, open-source projects; identify
// the app in the User-Agent; keep load light (they flag > ~720 /plan requests a day
// as heavy). We ask once per listing per place and cache the answer.
//
// Each trip leaves between 8:15 and 8:45am on the next Tuesday, New York time (a
// normal weekday schedule), and we keep the fastest door-to-door option. We also
// keep its route ("Walk 4 → A → Walk 6") so the number can be sanity-checked.

import type { Fetch } from "./buildings.ts";

const PLAN = "https://api.transitous.org/api/v1/plan";
export const USER_AGENT = "stoop/1.0 (personal rental search; https://github.com/theilsanne/stoop)";

/** UTC offset of New York at a given moment, e.g. "-05:00" in winter. */
export function nyOffset(at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT-5"; // e.g. "GMT-4"
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return "-05:00";
  return `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
}

/** Next Tuesday (never today) at the given New York time, as an ISO string with offset. */
export function nextTuesdayAt(hhmm: string, now = new Date()): string {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const days = ((2 - ny.getDay() + 7) % 7) || 7;
  const d = new Date(ny.getFullYear(), ny.getMonth(), ny.getDate() + days);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const probe = new Date(`${ymd}T14:00:00Z`); // midday UTC that day, to read that day's offset
  return `${ymd}T${hhmm}:00${nyOffset(probe)}`;
}
export const nextTuesdayNineAm = (now = new Date()) => nextTuesdayAt("09:00", now);
/** The window trips leave in: 8:15 plus 30 minutes. */
export const morningDeparture = (now = new Date()) => nextTuesdayAt("08:15", now);
const WINDOW_SECONDS = 30 * 60;

export function planUrl(from: { lat: number; lng: number }, to: { lat: number; lng: number }, departAt: string) {
  const q = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: new Date(departAt).toISOString(),
    arriveBy: "false",
    searchWindow: String(WINDOW_SECONDS),
    numItineraries: "6",
    detailedLegs: "false", // no map shapes; we only need the legs' modes and times
  });
  return `${PLAN}?${q}`;
}

type Leg = { mode?: string; duration?: number; startTime?: string; endTime?: string; routeShortName?: string; displayName?: string; tripShortName?: string };
type Trip = { duration?: number; startTime?: string; endTime?: string; legs?: Leg[] };

const secondsOf = (it: { duration?: number; startTime?: string; endTime?: string }) =>
  typeof it.duration === "number" ? it.duration
  : it.startTime && it.endTime ? (Date.parse(it.endTime) - Date.parse(it.startTime)) / 1000 : NaN;

/** "Walk 4 → A → C → Walk 6" */
export function routeSummary(trip: Trip | undefined, walkOnly = false): string {
  if (walkOnly) return `Walk ${Math.round(secondsOf(trip ?? {}) / 60)}`;
  const legs = trip?.legs ?? [];
  const parts = legs.flatMap((l) => {
    const mins = Math.round(secondsOf(l) / 60);
    if (l.mode === "WALK" || l.mode === "FOOT") return mins >= 1 ? [`Walk ${mins}`] : [];
    const name = l.routeShortName || l.displayName || l.tripShortName || (l.mode ?? "").toLowerCase();
    return [String(name)];
  });
  return parts.join(" → ");
}

/**
 * Fastest door-to-door trip from a MOTIS /plan response: a transit itinerary, or the
 * walking "direct" option when the place is close. null when there's no usable answer.
 */
export function bestTrip(body: unknown): { minutes: number; route: string } | null {
  const b = body as { itineraries?: Trip[]; direct?: Trip[] } | null;
  const all = [
    ...(b?.itineraries ?? []).map((t) => ({ t, walk: false })),
    ...(b?.direct ?? []).map((t) => ({ t, walk: true })),
  ].map((x) => ({ ...x, s: secondsOf(x.t) })).filter((x) => Number.isFinite(x.s) && x.s > 0);
  if (!all.length) return null;
  const best = all.reduce((a, x) => (x.s < a.s ? x : a));
  return { minutes: Math.round(best.s / 60), route: routeSummary(best.t, best.walk) };
}

export const minutesFromPlan = (body: unknown): number | null => bestTrip(body)?.minutes ?? null;

export async function lookupCommute(
  fetchFn: Fetch, from: { lat: number; lng: number }, to: { lat: number; lng: number }, departAt = morningDeparture(),
): Promise<{ minutes: number; route: string } | null> {
  const res = await (fetchFn as unknown as (u: string, i?: RequestInit) => ReturnType<Fetch>)(
    planUrl(from, to, departAt), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Transitous HTTP ${res.status}`);
  return bestTrip(await res.json());
}
