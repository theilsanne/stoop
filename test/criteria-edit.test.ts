// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Criterion } from "../supabase/functions/_shared/scoring.ts";
import { levelOf, withLevel } from "../app/src/criteria-edit.ts";

const crit = (o: Partial<Criterion> = {}): Criterion => ({
  id: "c", owner_id: "you", label: "c", kind: "want", field: "beds", operator: "gte", value: 2,
  weight: 5, near_miss_margin: null, active: true, ...o,
});

test("the ladder reads off kind, weight and active", () => {
  assert.equal(levelOf(null), "skip");
  assert.equal(levelOf(crit({ active: false })), "skip");
  assert.equal(levelOf(crit({ kind: "dealbreaker" })), "dealbreaker");
  assert.equal(levelOf(crit({ weight: 5 })), "important");
  assert.equal(levelOf(crit({ weight: 2 })), "nice");
});

test("a want weighted 4 or more is Important, including the 8 a Must have saved", () => {
  assert.equal(levelOf(crit({ weight: 4 })), "important");
  assert.equal(levelOf(crit({ weight: 8 })), "important");
  assert.equal(levelOf(crit({ weight: 3 })), "nice");
});

test("a want with no weight is Skip", () => {
  assert.equal(levelOf(crit({ weight: 0 })), "skip");
});

test("each step sets the stored shape scoring reads", () => {
  assert.deepEqual(
    (({ kind, weight, active }) => ({ kind, weight, active }))(withLevel(crit({ kind: "dealbreaker" }), "nice")),
    { kind: "want", weight: 2, active: true });
  assert.deepEqual(
    (({ kind, weight, active }) => ({ kind, weight, active }))(withLevel(crit({ weight: 2 }), "important")),
    { kind: "want", weight: 5, active: true });
  assert.equal(withLevel(crit(), "dealbreaker").kind, "dealbreaker");
  assert.equal(withLevel(crit(), "skip").active, false);
});

test("picking the level a criterion already reads leaves it alone, so a saved 8 stays 8", () => {
  const eight = crit({ weight: 8 });
  assert.equal(withLevel(eight, "important"), eight);
});

test("Skip keeps the settings, so turning it back on finds them", () => {
  const off = withLevel(crit({ value: 3600, kind: "dealbreaker", near_miss_margin: 0.05 }), "skip");
  assert.equal(off.value, 3600);
  assert.equal(off.near_miss_margin, 0.05);
  assert.equal(levelOf(withLevel(off, "dealbreaker")), "dealbreaker");
});

test("a new dealbreaker takes the starting margin only when it has none", () => {
  assert.equal(withLevel(crit(), "dealbreaker", 0.05).near_miss_margin, 0.05);
  assert.equal(withLevel(crit({ near_miss_margin: 0.1 }), "dealbreaker", 0.05).near_miss_margin, 0.1);
  assert.equal(withLevel(crit(), "dealbreaker").near_miss_margin, null);
});

test("withLevel does not change the criterion it was given", () => {
  const c = crit();
  withLevel(c, "dealbreaker", 0.05);
  assert.equal(c.kind, "want");
  assert.equal(c.near_miss_margin, null);
});
