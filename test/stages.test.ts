import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNS, columnOf, shouldShortlist, waitingFor } from "../app/src/stages.ts";

test("the board starts with Stamped, then the stored stages in order, without New", () => {
  assert.deepEqual(COLUMNS.map(([k]) => k),
    ["stamped", "shortlisted", "tour_requested", "toured", "applied", "won", "passed"]);
  assert.equal(COLUMNS[0][1], "Stamped");
});

test("a listing nobody stamped, with no stage, isn't on the board", () => {
  assert.equal(columnOf("new", false, false), null);
});

test("one stamp, from either of you, puts a new listing in Stamped", () => {
  assert.equal(columnOf("new", true, false), "stamped");
  assert.equal(columnOf("new", false, true), "stamped");
  assert.equal(columnOf("new", true, true), "stamped"); // until it's moved on to Shortlisted
});

test("a listing with a stage stays in its stage, whatever the stamps say", () => {
  assert.equal(columnOf("shortlisted", false, false), "shortlisted");
  assert.equal(columnOf("toured", true, false), "toured");
  assert.equal(columnOf("passed", true, true), "passed");
});

test("a stamped listing waits for whoever hasn't stamped it", () => {
  assert.equal(waitingFor("new", false, true), "me");       // the partner stamped it, I haven't
  assert.equal(waitingFor("new", true, false), "partner");  // I did, they haven't
});

test("nothing is waiting once both stamped, once neither did, or once it's moved on", () => {
  assert.equal(waitingFor("new", true, true), null);
  assert.equal(waitingFor("new", false, false), null);
  assert.equal(waitingFor("shortlisted", false, true), null);
  assert.equal(waitingFor("passed", true, false), null);
});

test("both stamps shortlist a listing that hasn't moved on, and nothing else", () => {
  assert.equal(shouldShortlist("new", true, true), true);
  assert.equal(shouldShortlist("new", true, false), false);
  assert.equal(shouldShortlist("new", false, true), false);
  assert.equal(shouldShortlist("new", false, false), false);
});

test("both stamps never pull a listing back from a later stage", () => {
  for (const stage of ["shortlisted", "tour_requested", "toured", "applied", "won", "passed"] as const) {
    assert.equal(shouldShortlist(stage, true, true), false, stage);
  }
});
