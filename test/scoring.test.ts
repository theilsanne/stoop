// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Criterion, type ScorableListing,
  evaluate, groupByOwner, netEffectiveRent, scoreListing, scorePerson,
} from "../supabase/functions/_shared/scoring.ts";
import { normalize } from "../supabase/functions/_shared/normalize.ts";

const crit = (o: Partial<Criterion>): Criterion => ({
  id: o.label ?? "c", owner_id: "you", label: "c", kind: "want", field: "price",
  operator: "lte", value: 0, weight: 5, near_miss_margin: null, active: true, ...o,
});

const listing = (o: Partial<ScorableListing> = {}): ScorableListing => ({
  id: "l1", price: 3450, net_effective_rent: 3163, neighborhood: "Crown Heights",
  beds: 2, baths: 1, sqft: 850, no_fee: true, available_date: "2026-12-01",
  amenities: { laundry_in_unit: false, dishwasher: true },
  building: { hpd_open_violations: 3, hpd_class_c_open: 0, complaints_311_12mo: 4, rent_stabilized: false },
  commutes: { placeYou: 28, placePartner: 35 },
  ...o,
});

test("net effective rent spreads free months over the lease", () => {
  assert.equal(netEffectiveRent(3450, 1, 12), 3163);
  assert.equal(netEffectiveRent(3450, null, null), 3450);
  assert.equal(netEffectiveRent(4100, 2, 14), 3514);
});

test("rent dealbreaker: pass, near miss, and miss", () => {
  const c = crit({ kind: "dealbreaker", field: "net_effective_rent", value: 3200, near_miss_margin: 0.05 });
  assert.equal(evaluate(c, listing()).pass, true);
  const near = evaluate(c, listing({ net_effective_rent: 3300 }));
  assert.equal(near.pass, false); assert.equal(near.near, true);
  const far = evaluate(c, listing({ net_effective_rent: 3600 }));
  assert.equal(far.pass, false); assert.equal(far.near, false);
});

test("wants are weighted; rent gets partial credit", () => {
  const p = scorePerson([
    crit({ label: "laundry", field: "amenities.laundry_in_unit", operator: "is_true", weight: 8 }),
    crit({ label: "dishwasher", field: "amenities.dishwasher", operator: "is_true", weight: 2 }),
  ], listing());
  assert.equal(p.score, 20); // 2 of 10 weight met
  const rent = evaluate(crit({ field: "net_effective_rent", value: 3000 }), listing()); // 5.4% over
  assert.ok(rent.credit > 0.4 && rent.credit < 0.5);
});

test("commute: each of you within the line; credit fades over 10 minutes", () => {
  const c = crit({ field: "commute", operator: "within_minutes", value: 30 });
  const r = evaluate(c, listing());
  assert.equal(r.pass, false);
  assert.equal(r.credit, 0.75); // (1 + 0.5) / 2
});

test("missing data is skipped, never counted against a listing", () => {
  const p = scorePerson([
    crit({ kind: "dealbreaker", label: "clean", field: "building.clean", operator: "is_true" }),
    crit({ label: "commute", field: "commute", operator: "within_minutes", value: 20, weight: 9 }),
    crit({ label: "dishwasher", field: "amenities.dishwasher", operator: "is_true", weight: 1 }),
  ], listing({ building: null, commutes: {} }));
  assert.equal(p.passes, true);
  assert.equal(p.score, 100); // only the dishwasher is known, and it's met
});

test("combined: must pass both people; score is the average", () => {
  const all = [
    crit({ owner_id: "you", kind: "dealbreaker", field: "neighborhood", operator: "in", value: ["Crown Heights"] }),
    crit({ owner_id: "you", field: "amenities.dishwasher", operator: "is_true" }),
    crit({ owner_id: "partner", kind: "dealbreaker", field: "neighborhood", operator: "in", value: ["Park Slope"], label: "Neighborhoods" }),
    crit({ owner_id: "partner", field: "amenities.laundry_in_unit", operator: "is_true" }),
  ];
  const r = scoreListing(groupByOwner(all), listing());
  assert.equal(r.per_person.you.passes, true);
  assert.equal(r.per_person.partner.passes, false);
  assert.equal(r.passes, false);
  assert.equal(r.score, 50); // (100 + 0) / 2
  assert.deepEqual(r.failed, ["Neighborhoods (partner)"]);
});

test("turned-off criteria are ignored", () => {
  const p = scorePerson([crit({ kind: "dealbreaker", field: "beds", operator: "gte", value: 3, active: false })], listing());
  assert.equal(p.passes, true);
});

test("normalize maps a StreetEasy-style item", () => {
  const row = normalize({
    id: 5028364, listingPath: "/building/812-sterling-place-brooklyn/3r",
    address: "812 Sterling Pl", unit: "#3R", areaName: "Crown Heights",
    price: "$3,450", freeMonths: 1, leaseTerm: 12, isNoFee: true,
    bedrooms: 2, bathrooms: 1, sqft: "850", availableDate: "2026-12-01",
    amenities: ["Dishwasher", "Laundry in Building", "Pets Allowed"],
    photos: [{ url: "https://photos.example/1.jpg" }],
    listedAt: "2026-10-01T18:29:35-04:00",
  })!;
  assert.equal(row.source_id, "5028364");
  assert.equal(row.url, "https://streeteasy.com/building/812-sterling-place-brooklyn/3r");
  assert.equal(row.price, 3450);
  assert.equal(row.net_effective_rent, 3163);
  assert.equal(row.neighborhood, "Crown Heights");
  assert.equal(row.no_fee, true);
  assert.deepEqual(row.amenities, { dishwasher: true, laundry_in_building: true, pets_allowed: true });
  assert.deepEqual(row.photos, ["https://photos.example/1.jpg"]);
  assert.equal(row.listed_at, "2026-10-01T22:29:35.000Z");
});

test("normalize skips items without an id or a price", () => {
  assert.equal(normalize({ address: "x", price: 3000 }), null);
  assert.equal(normalize({ id: 1, address: "x" }), null);
});
