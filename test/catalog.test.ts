// Run with:  node --experimental-strip-types --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../app/src/catalog.ts";

test("every feature on the Criteria page has a key, a label and a plain-language explanation", () => {
  for (const d of CATALOG) {
    assert.ok(d.key && d.label, `${d.key} needs a key and a label`);
    assert.ok(d.info.trim().length > 10, `${d.key} needs an explanation for its (i) button`);
    assert.ok(d.info.trim().endsWith("."), `${d.key}'s explanation should be a sentence`);
  }
});

test("feature keys are unique, so a tap always finds one row", () => {
  const keys = CATALOG.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a feature is told apart by its field and operator", () => {
  const ids = CATALOG.map((d) => `${d.field}|${d.operator}`);
  assert.equal(new Set(ids).size, ids.length);
});
