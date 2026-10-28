// Pure rules for editing a criteria list: the three weight levels, and moving a
// criterion between Dealbreakers and Wants. No DOM here, so the tests can import it.

import type { Criterion } from "./types.ts";

/** The three weights a want can be set to. Scoring only ever sees the number. */
export const WEIGHT_LEVELS = [
  { key: "nice", label: "Nice to have", weight: 2 },
  { key: "important", label: "Important", weight: 5 },
  { key: "must", label: "Must have", weight: 8 },
] as const;

/** The level a weight is set to, or null for a custom number (a want saved before levels existed). */
export const levelOf = (weight: number) => WEIGHT_LEVELS.find((l) => l.weight === weight) ?? null;

/** Move one criterion to the other list, after the last one already there. Returns the list unchanged if nothing moves. */
export function moveToSection(list: Criterion[], id: string, kind: Criterion["kind"]): Criterion[] {
  const i = list.findIndex((c) => c.id === id);
  if (i < 0 || list[i].kind === kind) return list;
  const rest = list.filter((c) => c.id !== id);
  const last = rest.map((c) => c.kind).lastIndexOf(kind);
  rest.splice(last < 0 ? rest.length : last + 1, 0, { ...list[i], kind });
  return rest;
}
