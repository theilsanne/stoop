// How much a criterion matters, as one ladder: Skip, Nice, Important, Dealbreaker.
// The stored shape is still kind + weight + active (scoring only reads those), so
// this maps the ladder onto them and back. Pure, so the tests can import it.

import type { Criterion } from "./types.ts";

export type Level = "skip" | "nice" | "important" | "dealbreaker";

export const LEVELS: { key: Level; label: string }[] = [
  { key: "skip", label: "Skip" },
  { key: "nice", label: "Nice" },
  { key: "important", label: "Important" },
  { key: "dealbreaker", label: "Dealbreaker" },
];

/** The weights behind the two want levels. */
export const NICE_WEIGHT = 2;
export const IMPORTANT_WEIGHT = 5;

type Settings = Pick<Criterion, "kind" | "weight" | "active">;

/**
 * Where a criterion sits on the ladder. A want weighted 4 or more reads as Important,
 * which includes the 8 that "Must have" used to save. A turned-off or zero-weight want is Skip.
 */
export function levelOf(c: Settings | null | undefined): Level {
  if (!c || !c.active) return "skip";
  if (c.kind === "dealbreaker") return "dealbreaker";
  const w = Number(c.weight);
  return w <= 0 ? "skip" : w >= 4 ? "important" : "nice";
}

/**
 * The criterion, set to a level. One already reading that level comes back untouched, so a
 * saved weight of 8 stays 8 until you pick a different step. nearMiss is the margin a new
 * numeric dealbreaker starts with when it has none.
 */
export function withLevel(c: Criterion, level: Level, nearMiss: number | null = null): Criterion {
  if (levelOf(c) === level) return c;
  switch (level) {
    case "skip": return { ...c, active: false };
    case "nice": return { ...c, kind: "want", weight: NICE_WEIGHT, active: true };
    case "important": return { ...c, kind: "want", weight: IMPORTANT_WEIGHT, active: true };
    case "dealbreaker": return { ...c, kind: "dealbreaker", active: true, near_miss_margin: c.near_miss_margin ?? nearMiss };
  }
}

const sorted = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : v ?? null);
const sameValue = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/**
 * How my pick and my partner's differ on one feature. "" when we agree, or neither of us picked it;
 * "level" when we care by different amounts (including one of us skipping it); "line" when we care
 * the same amount about a different number, date or list.
 */
export function differ(mine: Criterion | null, theirs: Criterion | null): "" | "level" | "line" {
  const a = levelOf(mine), b = levelOf(theirs);
  if (a === "skip" && b === "skip") return "";
  if (a !== b) return "level";
  return sameValue(mine!.value, theirs!.value) ? "" : "line";
}
