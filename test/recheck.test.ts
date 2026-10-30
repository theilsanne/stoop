import { test } from "node:test";
import assert from "node:assert/strict";
import { marketStatus, normalize } from "../supabase/functions/_shared/normalize.ts";
import { RECHECK_STAGES, recheckDue } from "../supabase/functions/_shared/recheck.ts";

test("StreetEasy's status decides whether a listing is still for rent", () => {
  assert.equal(marketStatus({ status: "ACTIVE" }), "active");
  for (const s of ["RENTED", "IN_CONTRACT", "NO_LONGER_AVAILABLE", "TEMPORARILY_OFF_MARKET"]) {
    assert.equal(marketStatus({ status: s }), "off_market", s);
  }
  assert.equal(marketStatus({}), "active"); // a search result with no status was just found live
  assert.equal(marketStatus({ latestListing_status: "RENTED" }), "off_market");
});

test("a single-listing result (from the re-check) still normalizes, link included", () => {
  const row = normalize({ id: "4261811", rent: 3250, urlPath: "/building/689-franklin-ave-brooklyn/3a", status: "RENTED" });
  assert.equal(row?.url, "https://streeteasy.com/building/689-franklin-ave-brooklyn/3a");
  assert.equal(row?.source_id, "4261811");
});

test("the re-check runs about weekly", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(recheckDue(null, now), true);
  assert.equal(recheckDue("2026-11-06T12:00:00Z", now), false);
  assert.equal(recheckDue("2026-11-01T12:00:00Z", now), true);
  assert.equal(recheckDue("2026-11-01T23:00:00Z", now), true); // a few hours short of a week is close enough
  assert.equal(recheckDue("garbage", now), true);
});

test("the re-check covers the stages still in play", () => {
  assert.deepEqual(RECHECK_STAGES, ["shortlisted", "tour_requested", "toured", "applied"]);
});
