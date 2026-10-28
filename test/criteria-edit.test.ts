// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Criterion } from "../supabase/functions/_shared/scoring.ts";
import { levelOf, moveToSection } from "../app/src/criteria-edit.ts";

const crit = (id: string, kind: Criterion["kind"], weight = 5): Criterion => ({
  id, owner_id: "you", label: id, kind, field: "beds", operator: "gte", value: 2,
  weight, near_miss_margin: null, active: true,
});

test("a weight maps to its level only when it is exactly one", () => {
  assert.equal(levelOf(2)?.key, "nice");
  assert.equal(levelOf(5)?.key, "important");
  assert.equal(levelOf(8)?.key, "must");
  assert.equal(levelOf(4), null);
  assert.equal(levelOf(0), null);
});

test("moving to the other list appends after the last criterion there", () => {
  const list = [crit("a", "dealbreaker"), crit("b", "want"), crit("c", "dealbreaker"), crit("d", "want")];
  const out = moveToSection(list, "a", "want");
  assert.deepEqual(out.map((c) => [c.id, c.kind]), [["b", "want"], ["c", "dealbreaker"], ["d", "want"], ["a", "want"]]);
});

test("moving into an empty list puts the criterion at the end", () => {
  const list = [crit("a", "want"), crit("b", "want")];
  const out = moveToSection(list, "a", "dealbreaker");
  assert.deepEqual(out.map((c) => [c.id, c.kind]), [["b", "want"], ["a", "dealbreaker"]]);
});

test("moving to the list it is already in changes nothing", () => {
  const list = [crit("a", "want"), crit("b", "dealbreaker")];
  assert.equal(moveToSection(list, "a", "want"), list);
});

test("an unknown id changes nothing, and the input is not mutated", () => {
  const list = [crit("a", "want")];
  assert.equal(moveToSection(list, "zzz", "dealbreaker"), list);
  moveToSection(list, "a", "dealbreaker");
  assert.equal(list[0].kind, "want");
});

test("moving keeps the other fields, including the weight", () => {
  const out = moveToSection([crit("a", "want", 8), crit("b", "dealbreaker")], "a", "dealbreaker");
  assert.equal(out[1].weight, 8);
  assert.equal(out[1].kind, "dealbreaker");
});
