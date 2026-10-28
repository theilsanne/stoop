import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metersBetween, type SubwayGraph, subwayCommute } from "../supabase/functions/_shared/subway.ts";

const g = JSON.parse(readFileSync(new URL("../supabase/functions/_shared/subway-graph.json", import.meta.url), "utf8")) as SubwayGraph;
const OFFICE = { lat: 40.74147, lng: -74.00303 }; // 111 8th Ave

test("the network looks like the NYC subway", () => {
  assert.ok(g.stations.length > 400 && g.stations.length < 600, `${g.stations.length} stations`);
  for (const l of ["A", "C", "G", "L", "2", "4", "F", "Q"]) assert.ok(g.lines.some((x) => x.startsWith(l + ":")), `line ${l}`);
  assert.ok(g.rides.every(([, , , s]) => s >= 30 && s < 1800), "rides between stops take 30s to 30min");
  assert.ok(g.waits.every(([, , w]) => w > 0 && w <= 600), "waits up to 10 min");
});

test("realistic subway commutes to 8th Ave and 15th St", () => {
  const trip = (lat: number, lng: number) => subwayCommute(g, { lat, lng }, OFFICE)!;
  const clinton = trip(40.68427, -73.96567); // 540 Waverly Ave, by Clinton-Washington Avs (C)
  assert.match(clinton.route, /→ C →|→ A →/);
  assert.ok(clinton.minutes >= 25 && clinton.minutes <= 40, `Clinton Hill ${clinton.minutes}`);
  const wburg = trip(40.7172, -73.9566); // by Bedford Av (L)
  assert.match(wburg.route, /→ L →/);
  assert.ok(wburg.minutes >= 12 && wburg.minutes <= 25, `Williamsburg ${wburg.minutes}`);
  const crown = trip(40.6706, -73.9580); // by Franklin Av
  assert.ok(crown.minutes >= 28 && crown.minutes <= 45, `Crown Heights ${crown.minutes}`);
  assert.doesNotMatch(crown.route, /B\d|M\d/, "subway only, no buses");
});

test("walking wins when it's close, and the route reads well", () => {
  const near = subwayCommute(g, { lat: 40.7425, lng: -74.0040 }, OFFICE)!;
  assert.match(near.route, /^Walk \d+$/);
  assert.ok(near.minutes <= 5);
  const r = subwayCommute(g, { lat: 40.6706, lng: -73.9580 }, OFFICE)!;
  assert.match(r.route, /^Walk \d+( → [A-Z0-9]+)+ → Walk \d+$/);
  assert.ok(Math.abs(metersBetween(OFFICE, { lat: 40.74147, lng: -73.99303 }) - 842) < 10);
});
