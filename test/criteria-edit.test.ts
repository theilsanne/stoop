// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Criterion } from "../supabase/functions/_shared/scoring.ts";
import { differ, levelOf, withLevel } from "../app/src/criteria-edit.ts";

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

test("two picks agree when the step and the line are the same", () => {
  assert.equal(differ(crit({ value: 3600, kind: "dealbreaker" }), crit({ value: 3600, kind: "dealbreaker" })), "");
});

test("neither of you picking a feature is not a difference", () => {
  assert.equal(differ(null, null), "");
  assert.equal(differ(crit({ active: false }), null), "");
});

test("caring by different amounts differs, including one of you skipping", () => {
  assert.equal(differ(crit({ kind: "dealbreaker" }), crit({ weight: 2 })), "level");
  assert.equal(differ(crit(), null), "level");
  assert.equal(differ(null, crit()), "level");
  assert.equal(differ(crit(), crit({ active: false })), "level");
});

test("the same step on a different number is a different line", () => {
  assert.equal(differ(crit({ kind: "dealbreaker", value: 3600 }), crit({ kind: "dealbreaker", value: 3800 })), "line");
});

test("two weights that both read as Important agree", () => {
  assert.equal(differ(crit({ weight: 8 }), crit({ weight: 5 })), "");
});

test("neighborhood lists agree whatever order they were ticked in, and differ when the members do", () => {
  const hood = (value: string[]) => crit({ kind: "dealbreaker", operator: "in", value });
  assert.equal(differ(hood(["A", "B"]), hood(["B", "A"])), "");
  assert.equal(differ(hood(["A", "B"]), hood(["A"])), "line");
});
