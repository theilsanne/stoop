// What a criteria list does to the market, for the Criteria page: how many listings fit,
// what each dealbreaker costs, the shape of the rents. All pure, on top of scoring.ts.

import {
  type Criterion, type ScorableListing, evaluate, groupByOwner, scoreListing, scorePerson,
} from "../../supabase/functions/_shared/scoring.ts";

/** How many listings meet one criterion, and how many have the data to say. */
export function coverage(c: Criterion, listings: ScorableListing[]): { fit: number; known: number } {
  let fit = 0, known = 0;
  for (const l of listings) {
    const r = evaluate(c, l);
    if (!r.known) continue;
    known++;
    if (r.pass) fit++;
  }
  return { fit, known };
}

/** How many listings meet one criterion. Listings it has no data for don't count either way. */
export const fitCount = (c: Criterion, listings: ScorableListing[]): number => coverage(c, listings).fit;

/**
 * How many listings this dealbreaker alone keeps out: the ones that pass every other
 * dealbreaker and miss this one. Zero for anything that isn't an active dealbreaker.
 */
export function dropCount(mine: Criterion[], c: Criterion, listings: ScorableListing[]): number {
  if (!c.active || c.kind !== "dealbreaker") return 0;
  const others = mine.filter((x) => x.active && x.kind === "dealbreaker" && x.id !== c.id);
  let n = 0;
  for (const l of listings) {
    const r = evaluate(c, l);
    if (!r.known || r.pass) continue;
    if (others.every((o) => { const e = evaluate(o, l); return !e.known || e.pass; })) n++;
  }
  return n;
}

/** The dealbreaker that keeps out the most listings, if any keeps out one. */
export function biggestCut(mine: Criterion[], listings: ScorableListing[]): { c: Criterion; n: number } | null {
  let best: { c: Criterion; n: number } | null = null;
  for (const c of mine) {
    const n = dropCount(mine, c, listings);
    if (n > (best?.n ?? 0)) best = { c, n };
  }
  return best;
}

export interface Preview {
  total: number;
  fit: number;    // pass all of my dealbreakers
  near: number;   // miss only by a little
  both: number;   // pass for both of us
  top: string[];  // ids of my best-scoring passing listings, best first
}

/** Score every listing with a candidate version of my list, next to my partner's. */
export function preview(mine: Criterion[], partner: Criterion[], listings: ScorableListing[], top = 6): Preview {
  const active = mine.filter((c) => c.active);
  const byOwner = groupByOwner([...active, ...partner.filter((c) => c.active)]);
  const passing: { id: string; score: number }[] = [];
  let fit = 0, near = 0, both = 0;
  for (const l of listings) {
    const p = scorePerson(active, l);
    if (p.passes) { fit++; passing.push({ id: l.id, score: p.score }); } else if (p.near_miss) near++;
    if (scoreListing(byOwner, l).passes) both++;
  }
  passing.sort((a, b) => b.score - a.score);
  return { total: listings.length, fit, near, both, top: passing.slice(0, top).map((x) => x.id) };
}

export interface Mood { word: string; tone: "good" | "warn" | "bad"; hint?: string }

/** How picky a list is, from the share of listings that still fit. */
export function mood(fit: number, total: number): Mood {
  if (!total) return { word: "No listings yet", tone: "warn" };
  if (!fit) return { word: "Nothing fits", tone: "bad", hint: "Loosen a dealbreaker." };
  const share = fit / total;
  if (share >= 0.6) return { word: "Wide open", tone: "good" };
  if (share >= 0.25) return { word: "Choosy", tone: "good" };
  return share >= 0.08 ? { word: "Picky", tone: "warn" } : { word: "Unicorn hunting", tone: "warn" };
}

/** The mood as a sentence. */
export function verdict(fit: number, total: number): string {
  const m = mood(fit, total);
  return `${m.word}.${m.hint ? " " + m.hint : ""}`;
}

export interface Bin { lo: number; hi: number; n: number }

/** Equal-width bins over the values (or over `range`, to line the bars up with a slider), for the bars behind a rent or size slider. */
export function histogram(values: number[], bins = 14, range?: [number, number]): Bin[] {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return [];
  const min = range ? range[0] : Math.min(...v), max = range ? range[1] : Math.max(...v);
  if (min === max) return [{ lo: min, hi: max, n: v.length }];
  const w = (max - min) / bins;
  const out = Array.from({ length: bins }, (_, i) => ({ lo: min + i * w, hi: min + (i + 1) * w, n: 0 }));
  for (const x of v) out[Math.max(0, Math.min(bins - 1, Math.floor((x - min) / w)))].n++;
  return out;
}
