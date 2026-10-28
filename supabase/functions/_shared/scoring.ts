// Scoring for Stoop. Pure functions only: no Supabase, no Deno APIs,
// so the same file runs in the edge functions and in the Node tests.
//
// Rules (same as the prototype):
//  - Each person has their own criteria (dealbreakers + weighted wants).
//  - A listing passes for a person if it passes all their active dealbreakers.
//  - A person's score = weighted share of their wants met, 0–100.
//    Numbers give partial credit fading out 10% past the line; commutes
//    fade out over 10 minutes past it.
//  - Combined: passes only if it passes for everyone; score = average.
//  - Missing data (no commute yet, no building record) is skipped, never
//    counted against a listing.

export type Operator =
  | "lte" | "gte" | "eq" | "in" | "not_in" | "is_true" | "before" | "within_minutes";

export interface Criterion {
  id: string;
  owner_id: string;
  label: string;
  kind: "dealbreaker" | "want";
  field: string;
  operator: Operator;
  value: unknown;
  weight: number;
  near_miss_margin: number | null;
  active: boolean;
}

export interface Building {
  hpd_open_violations: number | null;
  hpd_class_c_open: number | null;
  complaints_311_12mo: number | null;
  rent_stabilized: boolean | null;
}

/** A listing row plus what scoring needs from other tables. */
export interface ScorableListing {
  id: string;
  price: number | null;
  net_effective_rent: number | null;
  neighborhood: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  no_fee: boolean | null;
  available_date: string | null; // YYYY-MM-DD
  amenities: Record<string, boolean>;
  building?: Building | null;
  /** minutes keyed by place id; every place belongs to one of you */
  commutes?: Record<string, number>;
}

export interface CriterionResult {
  criterion_id: string;
  label: string;
  kind: Criterion["kind"];
  weight: number;
  pass: boolean;
  credit: number; // 0..1
  near: boolean;
  known: boolean; // false = data missing, skipped
  shown: string; // the listing's value, for the "why it scores" list
}

export interface PersonScore {
  score: number;
  passes: boolean;
  near_miss: boolean;
  failed: string[];
  breakdown: CriterionResult[];
}

export interface CombinedScore {
  score: number;
  passes: boolean;
  near_miss: boolean;
  failed: string[];
  per_person: Record<string, PersonScore>;
}

const FADE = 0.10; // partial credit fades to 0 at 10% past the line

const UNKNOWN = Symbol("unknown");
type Value = unknown | typeof UNKNOWN;

export function netEffectiveRent(
  price: number | null,
  freeMonths: number | null,
  leaseMonths: number | null,
): number | null {
  if (price == null) return null;
  const term = leaseMonths && leaseMonths > 0 ? leaseMonths : 12;
  const free = Math.min(Math.max(freeMonths ?? 0, 0), term);
  return Math.round((price * (term - free)) / term);
}

function getValue(l: ScorableListing, field: string): Value {
  if (field === "net_effective_rent") return l.net_effective_rent ?? l.price ?? UNKNOWN;
  if (field === "commute") {
    const mins = Object.values(l.commutes ?? {});
    return mins.length ? mins : UNKNOWN;
  }
  if (field.startsWith("commute:")) {
    // one place: "commute:<place id>"
    const m = l.commutes?.[field.slice(8)];
    return m == null ? UNKNOWN : [m];
  }
  if (field === "building.clean") {
    const b = l.building;
    if (!b || b.hpd_open_violations == null) return UNKNOWN;
    return (b.hpd_class_c_open ?? 0) === 0 && b.hpd_open_violations < 5;
  }
  if (field.startsWith("building.")) {
    const v = l.building?.[field.slice(9) as keyof Building];
    return v ?? UNKNOWN;
  }
  if (field.startsWith("amenities.")) {
    const v = l.amenities?.[field.slice(10)];
    return v === undefined ? UNKNOWN : !!v;
  }
  const v = (l as unknown as Record<string, unknown>)[field];
  return v ?? UNKNOWN;
}

function fmt(v: unknown, field: string): string {
  if (Array.isArray(v)) return v.join(" / ") + (field.startsWith("commute") ? " min" : "");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" && (field === "net_effective_rent" || field === "price")) {
    return "$" + v.toLocaleString("en-US");
  }
  return String(v);
}

export function evaluate(c: Criterion, l: ScorableListing): CriterionResult {
  const base = {
    criterion_id: c.id, label: c.label, kind: c.kind, weight: c.weight,
  };
  const v = getValue(l, c.field);
  if (v === UNKNOWN) {
    return { ...base, pass: true, credit: 0, near: false, known: false, shown: "unknown" };
  }
  const margin = c.near_miss_margin ?? 0;
  let pass = false, credit = 0, near = false;

  switch (c.operator) {
    case "lte": {
      const x = Number(v), line = Number(c.value);
      pass = x <= line;
      const over = (x - line) / line;
      credit = pass ? 1 : Math.max(0, 1 - over / FADE);
      near = !pass && margin > 0 && over <= margin;
      break;
    }
    case "gte": {
      const x = Number(v), line = Number(c.value);
      pass = x >= line;
      const under = (line - x) / line;
      credit = pass ? 1 : Math.max(0, 1 - under / FADE);
      near = !pass && margin > 0 && under <= margin;
      break;
    }
    case "eq":
      pass = v === c.value; credit = pass ? 1 : 0; break;
    case "in":
      pass = (c.value as unknown[]).includes(v); credit = pass ? 1 : 0; break;
    case "not_in":
      pass = !(c.value as unknown[]).includes(v); credit = pass ? 1 : 0; break;
    case "is_true":
      pass = !!v; credit = pass ? 1 : 0; break;
    case "before":
      pass = String(v) < String(c.value); credit = pass ? 1 : 0; break;
    case "within_minutes": {
      const mins = v as number[], line = Number(c.value);
      // commute credit fades out over 10 minutes past the line
      const each = mins.map((m) => (m <= line ? 1 : Math.max(0, 1 - (m - line) / 10)));
      credit = each.reduce((a, b) => a + b, 0) / each.length;
      pass = mins.every((m) => m <= line);
      near = !pass && margin > 0 && mins.every((m) => m <= line * (1 + margin));
      break;
    }
  }
  return { ...base, pass, credit, near, known: true, shown: fmt(v, c.field) };
}

export function scorePerson(criteria: Criterion[], l: ScorableListing): PersonScore {
  const breakdown = criteria.filter((c) => c.active).map((c) => evaluate(c, l));
  const misses = breakdown.filter((r) => r.kind === "dealbreaker" && r.known && !r.pass);
  const wants = breakdown.filter((r) => r.kind === "want" && r.known && r.weight > 0);
  const total = wants.reduce((a, r) => a + r.weight, 0);
  const score = total ? Math.round((100 * wants.reduce((a, r) => a + r.weight * r.credit, 0)) / total) : 100;
  const passes = misses.length === 0;
  return {
    score,
    passes,
    near_miss: !passes && misses.every((r) => r.near),
    failed: misses.map((r) => r.label),
    breakdown,
  };
}

/** criteriaByOwner: every person's active criteria, keyed by their user id. */
export function scoreListing(
  criteriaByOwner: Record<string, Criterion[]>,
  l: ScorableListing,
): CombinedScore {
  const per_person: Record<string, PersonScore> = {};
  for (const [owner, crit] of Object.entries(criteriaByOwner)) {
    per_person[owner] = scorePerson(crit, l);
  }
  const people = Object.values(per_person);
  if (!people.length) {
    return { score: 100, passes: true, near_miss: false, failed: [], per_person };
  }
  const passes = people.every((p) => p.passes);
  return {
    score: Math.round(people.reduce((a, p) => a + p.score, 0) / people.length),
    passes,
    near_miss: !passes && people.every((p) => p.passes || p.near_miss),
    failed: Object.entries(per_person).flatMap(([owner, p]) => p.failed.map((f) => `${f} (${owner})`)),
    per_person,
  };
}

export function groupByOwner(criteria: Criterion[]): Record<string, Criterion[]> {
  const out: Record<string, Criterion[]> = {};
  for (const c of criteria) (out[c.owner_id] ??= []).push(c);
  return out;
}
