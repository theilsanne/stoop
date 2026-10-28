// Builds the subway network Stoop uses for commute times, from the MTA's published
// subway timetable (GTFS). Run by .github/workflows/subway.yml:
//
//   node scripts/build-subway.mjs <unzipped gtfs folder> <output json>
//
// What it keeps, all from weekday trains running 7:30–9:30am (the usual morning
// pattern, so it doesn't matter which dates the timetable happens to cover):
//  - stations (one per station complex entrance group, with coordinates)
//  - rides: for each line and direction, the typical time between consecutive stops
//  - waits: half the typical gap between trains, per line, direction and station
//  - transfers between stations (from the MTA's transfers file)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error("usage: build-subway.mjs <gtfs dir> <out.json>"); process.exit(1); }

/** Minimal CSV reader (handles quoted fields with commas). */
function csv(file) {
  const text = readFileSync(join(dir, file), "utf8").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const secs = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const WINDOW = [7.5 * 3600, 9.5 * 3600];

// ---- stations
const stops = csv("stops.txt");
const parentOf = new Map(); // platform stop id -> station id
const stationRows = [];
for (const s of stops) {
  if (s.location_type === "1") stationRows.push(s);
  else if (s.parent_station) parentOf.set(s.stop_id, s.parent_station);
}
const stationIdx = new Map(stationRows.map((s, i) => [s.stop_id, i]));
const stations = stationRows.map((s) => ({ id: s.stop_id, name: s.stop_name, lat: +(+s.stop_lat).toFixed(6), lng: +(+s.stop_lon).toFixed(6) }));
const st = (stopId) => stationIdx.get(parentOf.get(stopId) ?? stopId);

// ---- lines (route + direction)
const routes = new Map(csv("routes.txt").map((r) => [r.route_id, r.route_short_name || r.route_id]));
let weekday = new Set();
try { weekday = new Set(csv("calendar.txt").filter((c) => c.monday === "1" && c.tuesday === "1" && c.wednesday === "1").map((c) => c.service_id)); } catch { /* no calendar.txt */ }
if (!weekday.size) {
  // some feeds only list dates (calendar_dates.txt): use the services running on a normal Tuesday in the feed
  const dates = csv("calendar_dates.txt").filter((d) => d.exception_type === "1");
  const tuesday = dates.find((d) => new Date(`${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}T12:00:00Z`).getUTCDay() === 2)?.date;
  weekday = new Set(dates.filter((d) => d.date === tuesday).map((d) => d.service_id));
}
if (!weekday.size) throw new Error("Couldn't find weekday service in the timetable");
const tripLine = new Map();
for (const t of csv("trips.txt")) {
  if (!weekday.has(t.service_id)) continue;
  tripLine.set(t.trip_id, `${routes.get(t.route_id) ?? t.route_id}:${t.direction_id || "0"}`);
}

// ---- rides and waits, from the stop times of morning weekday trips
const byTrip = new Map();
{
  const text = readFileSync(join(dir, "stop_times.txt"), "utf8");
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(",");
  const iTrip = head.indexOf("trip_id"), iStop = head.indexOf("stop_id"), iArr = head.indexOf("arrival_time"),
    iDep = head.indexOf("departure_time"), iSeq = head.indexOf("stop_sequence");
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(",");
    if (f.length < head.length) continue;
    const trip = f[iTrip];
    if (!tripLine.has(trip)) continue;
    let a = byTrip.get(trip);
    if (!a) byTrip.set(trip, (a = []));
    a.push({ s: st(f[iStop]), arr: secs(f[iArr] || f[iDep]), dep: secs(f[iDep] || f[iArr]), seq: +f[iSeq] });
  }
}

const lineIdx = new Map(); const lines = [];
const lineOf = (key) => { if (!lineIdx.has(key)) { lineIdx.set(key, lines.length); lines.push(key); } return lineIdx.get(key); };
const rideSamples = new Map();  // "line|from|to" -> seconds[]
const departures = new Map();   // "line|station" -> departure seconds[]
for (const [trip, list] of byTrip) {
  list.sort((x, y) => x.seq - y.seq);
  const line = lineOf(tripLine.get(trip));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.s == null) continue;
    if (a.dep >= WINDOW[0] && a.dep <= WINDOW[1]) {
      const k = `${line}|${a.s}`;
      (departures.get(k) ?? departures.set(k, []).get(k)).push(a.dep);
    }
    const b = list[i + 1];
    if (!b || b.s == null || b.s === a.s) continue;
    if (a.dep < WINDOW[0] - 1800 || a.dep > WINDOW[1]) continue;
    const k = `${line}|${a.s}|${b.s}`;
    (rideSamples.get(k) ?? rideSamples.set(k, []).get(k)).push(Math.max(30, b.arr - a.dep));
  }
}

const rides = [];
for (const [k, xs] of rideSamples) {
  if (xs.length < 2) continue; // a one-off trip pattern, not a regular service
  const [line, a, b] = k.split("|").map(Number);
  rides.push([line, a, b, median(xs)]);
}
const waits = [];
for (const [k, ds] of departures) {
  if (ds.length < 2) continue;
  const [line, s] = k.split("|").map(Number);
  const span = WINDOW[1] - WINDOW[0];
  const headway = span / ds.length;
  waits.push([line, s, Math.round(Math.min(headway / 2, 600))]); // half the gap, at most 10 min
}

// ---- transfers between different stations (same-station changes are handled by waits)
const transfers = [];
for (const t of csv("transfers.txt")) {
  const a = st(t.from_stop_id), b = st(t.to_stop_id);
  if (a == null || b == null || a === b) continue;
  transfers.push([a, b, +t.min_transfer_time || 180]);
}

const graph = {
  source: "MTA New York City Transit subway GTFS",
  built: new Date().toISOString().slice(0, 10),
  window: "weekdays 7:30–9:30am",
  stations, lines, rides, waits, transfers,
};
writeFileSync(out, JSON.stringify(graph));
console.log(`stations ${stations.length}, lines ${lines.length}, rides ${rides.length}, waits ${waits.length}, transfers ${transfers.length}, bytes ${JSON.stringify(graph).length}`);
