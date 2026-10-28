// Transit commute times from Transitous (https://transitous.org), a free, open
// public-transit router built on MOTIS. No account or key.
//
// Usage policy (transitous.org/api): non-commercial, open-source projects; identify
// the app in the User-Agent; keep load light (they flag > ~720 /plan requests a day
// as heavy). We ask once per listing per place and cache the answer.
//
// Each trip is planned to ARRIVE by 9:00am on the next Tuesday, New York time:
// a typical morning commute, on a normal weekday schedule.

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

/** Next Tuesday (never today) at 9:00 New York time, as an ISO string with offset. */
export function nextTuesdayNineAm(now = new Date()): string {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const days = ((2 - ny.getDay() + 7) % 7) || 7;
  const d = new Date(ny.getFullYear(), ny.getMonth(), ny.getDate() + days, 9, 0, 0);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const probe = new Date(`${ymd}T14:00:00Z`); // midday UTC that day, to read that day's offset
  return `${ymd}T09:00:00${nyOffset(probe)}`;
}

export function planUrl(from: { lat: number; lng: number }, to: { lat: number; lng: number }, arriveBy: string) {
  const q = new URLSearchParams({
    fromPlace: `${from.lat},${from.lng}`,
    toPlace: `${to.lat},${to.lng}`,
    time: new Date(arriveBy).toISOString(),
    arriveBy: "true",
    numItineraries: "3",
  });
  return `${PLAN}?${q}`;
}

const secondsOf = (it: { duration?: number; startTime?: string; endTime?: string }) =>
  typeof it.duration === "number" ? it.duration
  : it.startTime && it.endTime ? (Date.parse(it.endTime) - Date.parse(it.startTime)) / 1000 : NaN;

/**
 * Shortest door-to-door trip in whole minutes, from a MOTIS /plan response:
 * transit itineraries, or the walk/bike "direct" option when the place is close.
 * null when there's no usable answer.
 */
export function minutesFromPlan(body: unknown): number | null {
  const b = body as { itineraries?: unknown[]; direct?: unknown[] } | null;
  const all = [...(b?.itineraries ?? []), ...(b?.direct ?? [])] as { duration?: number; startTime?: string; endTime?: string }[];
  const secs = all.map(secondsOf).filter((s) => Number.isFinite(s) && s > 0);
  if (!secs.length) return null;
  return Math.round(Math.min(...secs) / 60);
}

export async function lookupCommute(
  fetchFn: Fetch, from: { lat: number; lng: number }, to: { lat: number; lng: number }, arriveBy = nextTuesdayNineAm(),
): Promise<number | null> {
  const res = await (fetchFn as unknown as (u: string, i?: RequestInit) => ReturnType<Fetch>)(
    planUrl(from, to, arriveBy), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`Transitous HTTP ${res.status}`);
  return minutesFromPlan(await res.json());
}
