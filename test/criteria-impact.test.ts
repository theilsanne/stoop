// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Criterion, ScorableListing } from "../supabase/functions/_shared/scoring.ts";
import { biggestCut, coverage, dropCount, fitCount, histogram, mood, preview, verdict } from "../app/src/criteria-impact.ts";

const crit = (o: Partial<Criterion>): Criterion => ({
  id: o.id ?? "c", owner_id: "you", label: "c", kind: "dealbreaker", field: "price",
  operator: "lte", value: 0, weight: 5, near_miss_margin: null, active: true, ...o,
});

const listing = (id: string, price: number | null, beds: number | null): ScorableListing => ({
  id, price, net_effective_rent: price, neighborhood: "Crown Heights", beds, baths: 1, sqft: 800,
  no_fee: true, available_date: "2026-12-01", amenities: {}, building: null, commutes: {},
});

const rent = crit({ id: "rent", field: "price", operator: "lte", value: 3600 });
const bedrooms = crit({ id: "beds", field: "beds", operator: "gte", value: 2 });
// A passes both; B misses rent only; C misses beds only; D misses both; E has no data
const market = [listing("A", 3000, 2), listing("B", 4000, 2), listing("C", 3000, 1), listing("D", 4000, 1), listing("E", null, null)];

test("fitCount counts the listings that meet a criterion, and skips ones with no data", () => {
  assert.equal(fitCount(rent, market), 2);   // A and C; E has no price
  assert.equal(fitCount(bedrooms, market), 2); // A and B
});

test("coverage says how many fit and how many had the data to say", () => {
  assert.deepEqual(coverage(rent, market), { fit: 2, known: 4 }); // E has no price
});

test("dropCount is what one dealbreaker keeps out that the others would let through", () => {
  const mine = [rent, bedrooms];
  assert.equal(dropCount(mine, rent, market), 1);     // B only; D is out on beds anyway
  assert.equal(dropCount(mine, bedrooms, market), 1); // C only
});

test("dropCount is zero for wants and for turned-off dealbreakers", () => {
  assert.equal(dropCount([rent], { ...rent, kind: "want" }, market), 0);
  assert.equal(dropCount([rent], { ...rent, active: false }, market), 0);
});

test("biggestCut finds the dealbreaker costing the most, or nothing", () => {
  const cheap = crit({ id: "cheap", field: "price", operator: "lte", value: 3200 });
  const cut = biggestCut([cheap, bedrooms], [...market, listing("F", 3500, 2)]);
  assert.equal(cut?.c.id, "cheap");
  assert.equal(cut?.n, 2); // B and F; D is out on beds anyway
  assert.equal(biggestCut([], market), null);
  assert.equal(biggestCut([{ ...rent, value: 99999 }], market), null);
});

test("preview counts who fits me and who fits both of us, and lists my best first", () => {
  const wantBeds = crit({ id: "wb", kind: "want", field: "beds", operator: "gte", value: 2, weight: 5 });
  const partner = [crit({ id: "p", owner_id: "them", field: "price", operator: "lte", value: 3200 })];
  const p = preview([rent, wantBeds], partner, market);
  assert.equal(p.total, 5);
  assert.equal(p.fit, 3);      // A and C pass rent; E has no price, and missing data is let through
  assert.equal(p.both, 3);     // A, C and E also pass my partner's 3200 cap
  assert.equal(p.top[0], "A"); // has the beds, so scores 100; C scores lower
});

test("preview with an empty list lets everything through", () => {
  const p = preview([], [], market);
  assert.equal(p.fit, 5);
  assert.equal(p.both, 5);
});

test("a skipped criterion is left out of the preview", () => {
  const p = preview([{ ...rent, active: false }], [], market);
  assert.equal(p.fit, 5);
});

test("verdict says how picky a list is", () => {
  assert.equal(verdict(0, 0), "No listings yet.");
  assert.match(verdict(0, 40), /Nothing fits/);
  assert.equal(verdict(30, 40), "Wide open.");
  assert.equal(verdict(14, 40), "Choosy.");
  assert.equal(verdict(5, 40), "Picky.");
  assert.equal(verdict(1, 40), "Unicorn hunting.");
});

test("histogram bins every value once", () => {
  const bins = histogram([3000, 3100, 3500, 4000, 4200, 4200], 4);
  assert.equal(bins.length, 4);
  assert.equal(bins.reduce((a, b) => a + b.n, 0), 6);
  assert.equal(bins[0].lo, 3000);
  assert.equal(bins[3].hi, 4200);
  assert.equal(bins[3].n, 3); // 4000 and both 4200s; the maximum lands in the last bin, not off the end
});

test("histogram of nothing is empty, and of one value is a single bar", () => {
  assert.deepEqual(histogram([]), []);
  assert.deepEqual(histogram([3000, 3000]), [{ lo: 3000, hi: 3000, n: 2 }]);
});

test("histogram over a given range lines up with a slider and keeps every value", () => {
  const bins = histogram([3000, 3600, 4200], 6, [2800, 4400]);
  assert.equal(bins[0].lo, 2800);
  assert.equal(bins[5].hi, 4400);
  assert.equal(bins.reduce((a, b) => a + b.n, 0), 3);
});

test("mood gives the stamp a word and a tone", () => {
  assert.deepEqual(mood(30, 40), { word: "Wide open", tone: "good" });
  assert.equal(mood(14, 40).tone, "good");
  assert.deepEqual(mood(5, 40), { word: "Picky", tone: "warn" });
  assert.equal(mood(1, 40).word, "Unicorn hunting");
  assert.deepEqual(mood(0, 40), { word: "Nothing fits", tone: "bad", hint: "Loosen a dealbreaker." });
});
