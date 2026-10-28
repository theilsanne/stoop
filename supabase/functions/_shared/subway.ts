// Subway-only commute times, worked out here rather than by an outside service.
//
// The network (subway-graph.json) is built from the MTA's own timetable by
// scripts/build-subway.mjs, using the normal weekday 7:30–9:30am pattern. A trip is:
//   walk to a station → wait (half the usual gap between trains) → ride
//   → [change: walk between platforms or stations, wait again] → ride → walk to the place.
// The fastest such trip (or just walking, if that's quicker) is the commute.
//
// Pure functions, no network: the same file runs in the edge functions and the tests.

export interface SubwayGraph {
  stations: { id: string; name: string; lat: number; lng: number }[];
  lines: string[];                                // "A:0" = A train, direction 0
  rides: [number, number, number, number][];      // line, from station, to station, seconds
  waits: [number, number, number][];              // line, station, seconds
  transfers: [number, number, number][];          // station, station, seconds
}

export interface Point { lat: number; lng: number }

const WALK_M_PER_S = 1.3;          // about 4.7 km/h
const DETOUR = 1.3;                // streets aren't straight lines
const MAX_STATION_WALK_M = 1600;   // about a 25 minute walk, at most, to or from a station
const CHANGE_SECONDS = 120;        // getting from one platform to another in the same station
const ENTRY_SECONDS = 90;          // into the station, through the turnstile, down to the platform

export function metersBetween(a: Point, b: Point) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const walkSeconds = (a: Point, b: Point) => (metersBetween(a, b) * DETOUR) / WALK_M_PER_S;

/** Prepared lookups, built once per graph. */
interface Prepared {
  g: SubwayGraph;
  ridesFrom: Map<string, [number, number][]>;      // "line|station" -> [next station, seconds]
  linesAt: Map<number, [number, number][]>;        // station -> [line, wait seconds]
  transfersFrom: Map<number, [number, number][]>;  // station -> [other station, seconds]
}
const prepared = new WeakMap<SubwayGraph, Prepared>();
function prepare(g: SubwayGraph): Prepared {
  let p = prepared.get(g);
  if (p) return p;
  const ridesFrom = new Map<string, [number, number][]>();
  for (const [line, a, b, s] of g.rides) {
    const k = `${line}|${a}`;
    (ridesFrom.get(k) ?? ridesFrom.set(k, []).get(k)!).push([b, s]);
  }
  const linesAt = new Map<number, [number, number][]>();
  for (const [line, s, w] of g.waits) (linesAt.get(s) ?? linesAt.set(s, []).get(s)!).push([line, w]);
  const transfersFrom = new Map<number, [number, number][]>();
  for (const [a, b, s] of g.transfers) (transfersFrom.get(a) ?? transfersFrom.set(a, []).get(a)!).push([b, s]);
  p = { g, ridesFrom, linesAt, transfersFrom };
  prepared.set(g, p);
  return p;
}

/** A small binary heap of [cost, node]. */
class Heap {
  private a: [number, string][] = [];
  get size() { return this.a.length; }
  push(x: [number, string]) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

export interface SubwayTrip { minutes: number; route: string }

/**
 * Fastest subway trip (or walk) from one point to another.
 * Nodes: "s:<station>" = on the street/concourse at a station; "r:<line>:<station>" = on a train.
 */
export function subwayCommute(g: SubwayGraph, from: Point, to: Point): SubwayTrip | null {
  const P = prepare(g);
  const direct = walkSeconds(from, to);

  // the last walk, from each station near the destination
  const exitWalk = new Map<number, number>();
  g.stations.forEach((s, i) => { if (metersBetween(s, to) <= MAX_STATION_WALK_M) exitWalk.set(i, walkSeconds(s, to)); });

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const heap = new Heap();
  const relax = (node: string, cost: number, from_: string) => {
    if (cost < (dist.get(node) ?? Infinity)) { dist.set(node, cost); prev.set(node, from_); heap.push([cost, node]); }
  };
  g.stations.forEach((s, i) => {
    if (metersBetween(from, s) <= MAX_STATION_WALK_M) relax(`s:${i}`, walkSeconds(from, s) + ENTRY_SECONDS, "start");
  });

  let best = direct, bestEnd = "walk";
  while (heap.size) {
    const [cost, node] = heap.pop();
    if (cost > (dist.get(node) ?? Infinity)) continue;
    if (cost >= best) break; // nothing left can beat the best trip found
    const [kind, x, y] = node.split(":");
    if (kind === "s") {
      const s = +x;
      const out = exitWalk.get(s);
      if (out != null && cost + out < best && prev.get(node)?.startsWith("r:")) { best = cost + out; bestEnd = node; }
      // board a train here: wait for it
      for (const [line, wait] of P.linesAt.get(s) ?? []) relax(`r:${line}:${s}`, cost + wait, node);
      // walk to a connected station
      for (const [b, t] of P.transfersFrom.get(s) ?? []) relax(`s:${b}`, cost + t, node);
    } else {
      const line = +x, s = +y;
      // stay on the train
      for (const [b, t] of P.ridesFrom.get(`${line}|${s}`) ?? []) relax(`r:${line}:${b}`, cost + t, node);
      // get off (changing platforms costs a little before the next wait)
      relax(`s:${s}`, cost + (exitWalk.has(s) ? 0 : CHANGE_SECONDS), node);
    }
  }
  if (!Number.isFinite(best)) return null;
  if (bestEnd === "walk") return { minutes: Math.round(direct / 60), route: `Walk ${Math.round(direct / 60)}` };

  // trace back the route: walks and the lines ridden
  const path: string[] = [];
  for (let n: string | undefined = bestEnd; n && n !== "start"; n = prev.get(n)) path.push(n);
  path.reverse();
  const firstStation = +path[0].split(":")[1];
  const lastStation = +bestEnd.split(":")[1];
  const parts = [`Walk ${Math.max(1, Math.round(walkSeconds(from, g.stations[firstStation]) / 60))}`];
  let lastLine = "";
  for (const n of path) {
    if (!n.startsWith("r:")) continue;
    const name = g.lines[+n.split(":")[1]].split(":")[0];
    if (name !== lastLine) { parts.push(name); lastLine = name; }
  }
  parts.push(`Walk ${Math.max(1, Math.round(exitWalk.get(lastStation)! / 60))}`);
  return { minutes: Math.round(best / 60), route: parts.join(" → ") };
}
