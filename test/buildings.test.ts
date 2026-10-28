// Building-record helpers, with a fake network.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bblFromGeosearch, complaints311Url, matchGeosearch, count311, countHpd, geosearchUrl, hpdUrl, lookupBbl, lookupBuilding, streetOnly,
} from "../supabase/functions/_shared/buildings.ts";

const geo = (props: Record<string, unknown>) => ({ features: [{ properties: props }] });

test("street without the unit, and the GeoSearch query", () => {
  assert.equal(streetOnly("2683 Atlantic Avenue #320"), "2683 Atlantic Avenue");
  assert.equal(streetOnly("408 Madison Street #PHB"), "408 Madison Street");
  assert.equal(streetOnly("812 Sterling Place"), "812 Sterling Place");
  const url = decodeURIComponent(geosearchUrl("2683 Atlantic Avenue #320", "11207"));
  assert.match(url, /text=2683 Atlantic Avenue, Brooklyn, NY 11207&size=1$/);
});

test("BBL only from a matching building result", () => {
  const good = { layer: "address", confidence: 1, postalcode: "11207", housenumber: "2683", label: "2683 Atlantic Avenue, Brooklyn, NY, USA", addendum: { pad: { bbl: "3036690035", bin: "3083512" } } };
  const S = "2683 Atlantic Avenue";
  assert.equal(bblFromGeosearch(geo(good), "11207", S), "3036690035");
  // the right house number is enough, even when the score or ZIP is off
  assert.equal(bblFromGeosearch(geo({ ...good, confidence: 0.6 }), "11207", S), "3036690035");
  assert.equal(bblFromGeosearch(geo({ ...good, postalcode: "11208" }), "11207", S), "3036690035");
  // house number from the label when there's no housenumber field
  assert.equal(bblFromGeosearch(geo({ ...good, housenumber: undefined }), "11207", S), "3036690035");
  // a neighbor isn't the building
  assert.equal(bblFromGeosearch(geo({ ...good, housenumber: "2685" }), "11207", S), null);
  assert.equal(bblFromGeosearch(geo({ ...good, layer: "street" }), "11207", S), null);      // street, not a building
  assert.equal(bblFromGeosearch(geo({ ...good, addendum: {} }), "11207", S), null);
  assert.equal(bblFromGeosearch({ features: [] }, "11207", S), null);
  // numeric BBLs work too
  assert.equal(bblFromGeosearch(geo({ ...good, addendum: { pad: { bbl: 3036690035 } } }), "11207", S), "3036690035");
  // and a failure says why
  assert.match(matchGeosearch(geo({ ...good, housenumber: "2685" }), "11207", S).why, /different house number/);
});

test("HPD counts by class; 311 count", () => {
  assert.deepEqual(countHpd([{ class: "A", n: "3" }, { class: "B", n: "2" }, { class: "C", n: "1" }]), { total: 6, classC: 1 });
  assert.deepEqual(countHpd([]), { total: 0, classC: 0 }); // no open violations is a real answer
  assert.equal(countHpd({ error: true }), null);
  assert.equal(count311([{ n: "14" }]), 14);
  assert.equal(count311([]), null);
  assert.match(decodeURIComponent(hpdUrl("3036690035")), /bbl = '3036690035' AND violationstatus = 'Open'/);
  assert.match(decodeURIComponent(complaints311Url("3036690035", new Date("2026-10-28T12:00:00Z"))), /created_date > '2025-10-28T12:00:00'/);
});

test("lookups fail soft", async () => {
  const fake = (routes: Record<string, unknown>) => async (url: string) => {
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  };
  const f = fake({
    "geosearch": geo({ layer: "address", confidence: 1, postalcode: "11207", addendum: { pad: { bbl: "3036690035" } } }),
    "wvxf-dwi5": [{ class: "C", n: "2" }, { class: "B", n: "1" }],
  });
  assert.equal((await lookupBbl(f, "2683 Atlantic Avenue", "11207")).bbl, "3036690035");
  const b = await lookupBuilding(f, "3036690035");
  assert.equal(b.hpd_open_violations, 3);
  assert.equal(b.hpd_class_c_open, 2);
  assert.equal(b.complaints_311_12mo, null); // 311 failed: unknown, not zero
  assert.equal(b.errors.length, 1);
  // the lookup service failing is not "no match": it's retried later
  const down = await lookupBbl(fake({}), "1 Nowhere St", null);
  assert.equal(down.bbl, null);
  assert.match(down.error ?? "", /HTTP 500/);
});
