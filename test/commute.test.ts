import { test } from "node:test";
import assert from "node:assert/strict";
import { minutesFromPlan, nextTuesdayNineAm, nyOffset, planUrl } from "../supabase/functions/_shared/commute.ts";
import { evaluate, type Criterion, type ScorableListing } from "../supabase/functions/_shared/scoring.ts";

test("arrive by 9am next Tuesday, New York time, across the clock change", () => {
  // Wed Oct 28 2026 -> Tue Nov 3 (after clocks go back Nov 1): EST
  assert.equal(nextTuesdayNineAm(new Date("2026-10-28T15:00:00Z")), "2026-11-03T09:00:00-05:00");
  // Wed Oct 14 2026 -> Tue Oct 20: still EDT
  assert.equal(nextTuesdayNineAm(new Date("2026-10-14T15:00:00Z")), "2026-10-20T09:00:00-04:00");
  // on a Tuesday, it's the following Tuesday
  assert.equal(nextTuesdayNineAm(new Date("2026-11-03T13:00:00Z")), "2026-11-10T09:00:00-05:00");
  assert.equal(nyOffset(new Date("2026-07-01T12:00:00Z")), "-04:00");
});

test("plan request and the shortest trip", () => {
  const url = planUrl({ lat: 40.67, lng: -73.95 }, { lat: 40.7411, lng: -74.0034 }, "2026-11-03T09:00:00-05:00");
  assert.match(url, /^https:\/\/api\.transitous\.org\/api\/v1\/plan\?/);
  assert.match(url, /fromPlace=40\.67%2C-73\.95/);
  assert.match(url, /arriveBy=true/);
  assert.match(url, /time=2026-11-03T14%3A00%3A00\.000Z/);
  assert.equal(minutesFromPlan({ itineraries: [{ duration: 2100 }, { duration: 1980 }] }), 33);
  assert.equal(minutesFromPlan({ itineraries: [{ startTime: "2026-11-03T13:20:00Z", endTime: "2026-11-03T13:58:00Z" }] }), 38);
  assert.equal(minutesFromPlan({ itineraries: [{ duration: 3000 }], direct: [{ duration: 900 }] }), 15); // walkable
  assert.equal(minutesFromPlan({ itineraries: [] }), null);
  assert.equal(minutesFromPlan(null), null);
});

test("a commute criterion for one place", () => {
  const c: Criterion = { id: "c", owner_id: "me", label: "Commute to Office", kind: "want", field: "commute:place-1",
    operator: "within_minutes", value: 35, weight: 5, near_miss_margin: null, active: true };
  const l = (commutes: Record<string, number>): ScorableListing => ({ id: "l", price: 3000, net_effective_rent: 3000,
    neighborhood: null, beds: 1, baths: 1, sqft: null, no_fee: true, available_date: null, amenities: {}, commutes });
  assert.equal(evaluate(c, l({ "place-1": 30 })).pass, true);
  assert.equal(evaluate(c, l({ "place-1": 40 })).credit, 0.5);
  assert.equal(evaluate(c, l({ "place-1": 40 })).shown, "40 min");
  assert.equal(evaluate(c, l({ "place-2": 10 })).known, false); // other place only: unknown, skipped
});
