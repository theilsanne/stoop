import type { AlertState } from "./push.ts";
import {
  type ScorableListing, groupByOwner, scoreListing, scorePerson,
} from "../../supabase/functions/_shared/scoring.ts";
import type { Api } from "./api.ts";
import type { Criterion, FeedRow, Me, PersonScore, Place, Profile, Rating, Verdict } from "./types.ts";
import { CATALOG, type FieldDef } from "./catalog.ts";
import { clone, save, store } from "./util.ts";

export type Tab = "feed" | "pipeline" | "criteria" | "compare" | "settings";
export type Lens = "both" | "me" | "partner";
export type Filter = "passing" | "near" | "other";
export type Sort = "score" | "newest" | "rent";

export interface State {
  api: Api;
  me: Me | null;
  profiles: Profile[];
  feed: FeedRow[];
  ratings: Rating[];
  criteria: Criterion[];   // both people's saved lists
  places: Place[];         // commute destinations, both people's
  draft: Criterion[];      // my list as being edited
  tab: Tab;
  lens: Lens;
  filter: Filter;
  sort: Sort;
  feedView: "list" | "map";
  whyOpen: Set<string>;    // feed cards with their score explanation expanded
  shown: number;           // feed cards rendered so far
  openId: string | null;   // listing detail sheet
  bdWho: "me" | "partner";
  lastVisit: number;       // for "new since your last visit"
  loading: boolean;
  saving: boolean;         // saving criteria or a place
  busy: Set<string>;       // long-running Settings actions in progress, by name
  error: string | null;
  sentLinkTo: string | null;
  alerts: AlertState;      // phone alerts on this device
}

export const S = {} as State;

/** The section a criterion added since the last save was put in (it stays there until you save). */
export const addedAs = new Map<string, Criterion["kind"]>();

/** Put one section's criteria in the given order, leaving the other section where it is. */
export function reorderSection(section: Criterion["kind"], ids: string[]) {
  const slots = S.draft.flatMap((c, i) => (sectionOf(c) === section ? [i] : []));
  const byId = new Map(S.draft.map((c) => [c.id, c]));
  if (ids.length !== slots.length || ids.some((id) => !byId.has(id))) return;
  slots.forEach((slot, k) => { S.draft[slot] = byId.get(ids[k])!; });
}

/** Move one criterion up (-1) or down (1) within its section. */
export function moveInSection(id: string, dir: -1 | 1) {
  const c = S.draft.find((x) => x.id === id);
  if (!c) return false;
  const ids = S.draft.filter((x) => sectionOf(x) === sectionOf(c)).map((x) => x.id);
  const i = ids.indexOf(id), j = i + dir;
  if (j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  reorderSection(sectionOf(c), ids);
  return true;
}

/** Which section a criterion shows in: where it was when last saved, so switching
 *  Dealbreaker/Want doesn't move it out from under you before you save. */
export function sectionOf(c: Criterion): Criterion["kind"] {
  return myCriteria().find((x) => x.id === c.id)?.kind ?? addedAs.get(c.id) ?? c.kind;
}

export function initState(api: Api) {
  Object.assign(S, {
    api, me: null, profiles: [], feed: [], ratings: [], criteria: [], places: [], draft: [],
    tab: store<Tab>("tab", "feed"), lens: "both",
    filter: "passing", sort: store<Sort>("sort", "score"), feedView: store<"list" | "map">("feedView", "list"), whyOpen: new Set(), shown: 40,
    openId: null, bdWho: "me", lastVisit: store<number>("lastVisit", 0),
    loading: true, saving: false, busy: new Set(), error: null, sentLinkTo: null, alerts: "checking",
  } satisfies State);
}

// ---------- people ----------
export const myId = () => S.me?.id ?? "";
export const partner = (): Profile | null => S.profiles.find((p) => p.id !== myId()) ?? null;
export const partnerId = () => partner()?.id ?? "";
export const partnerName = () => partner()?.display_name || "Partner";
export const nameOf = (id: string) => (id === myId() ? "You" : id === partnerId() ? partnerName() : "Someone");

export const myCriteria = () => S.criteria.filter((c) => c.owner_id === myId());
export const partnerCriteria = () => S.criteria.filter((c) => c.owner_id === partnerId());
/**
 * The settings that matter, in a stable form: ignores key order, how the database
 * formats numbers, and the order neighborhoods were ticked in.
 */
export function settingsOf(list: Criterion[]) {
  const norm = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : typeof v === "number" ? Number(v) : v ?? null);
  return JSON.stringify(list.map((c) => [
    c.id, c.label.trim(), c.kind, c.field, c.operator, norm(c.value),
    Number(c.weight), Math.round(Number(c.near_miss_margin ?? 0) * 100), !!c.active,
  ]));
}
export const draftDirty = () => settingsOf(myCriteria()) !== settingsOf(S.draft);

// ---------- unsaved criteria edits ----------
// Kept on this device so they survive a reload, a new tab, or closing the app.
interface StoredDraft { user: string; base: string; draft: Criterion[]; at: number }

/** Start the draft over from what's saved. clearStored=false keeps any edits waiting on this device. */
export function resetDraft(clearStored = true) {
  addedAs.clear();
  S.draft = clone(myCriteria());
  if (clearStored) save("draft", null);
}

/** Remember the current draft on this device (or forget it once it matches what's saved). */
export function persistDraft() {
  if (!S.me || S.loading) return;
  save("draft", draftDirty()
    ? ({ user: myId(), base: settingsOf(myCriteria()), draft: S.draft, at: Date.now() } satisfies StoredDraft)
    : null);
}

/**
 * On load, bring back unsaved edits from an earlier visit.
 * "stale" = your saved criteria changed since (e.g. saved from another device), so the edits were dropped.
 */
export function restoreDraft(): "restored" | "stale" | null {
  const d = store<StoredDraft | null>("draft", null);
  if (!d || d.user !== myId()) return null;
  if (d.base !== settingsOf(myCriteria())) {
    save("draft", null);
    // only worth mentioning if the dropped edits actually changed something
    return settingsOf(d.draft) !== d.base ? "stale" : null;
  }
  S.draft = clone(d.draft);
  return draftDirty() ? "restored" : null;
}

// ---------- ratings ----------
export const ratingOf = (listingId: string, userId: string): Rating | undefined =>
  S.ratings.find((r) => r.listing_id === listingId && r.user_id === userId);
export const verdictOf = (listingId: string, userId: string): Verdict | null =>
  ratingOf(listingId, userId)?.verdict ?? null;

// ---------- scores ----------
export interface View { score: number; passes: boolean; near: boolean; failed: string[]; scored: boolean }

const unscored: View = { score: 0, passes: false, near: false, failed: [], scored: false };

function fromPerson(p: PersonScore | undefined): View {
  return p ? { score: p.score, passes: p.passes, near: p.near_miss, failed: p.failed, scored: true } : unscored;
}

/** The stored (server-computed) score for the current lens. */
export function viewOf(row: FeedRow, lens: Lens = S.lens): View {
  if (lens === "me") return fromPerson(row.per_person?.[myId()]);
  if (lens === "partner") return fromPerson(row.per_person?.[partnerId()]);
  if (row.score == null) return unscored;
  const failed = (row.failed ?? []).map((f) =>
    f.replace(/ \(([0-9a-f-]{36}|demo-[a-z]+)\)$/, (_, id) => ` (${nameOf(id) === "You" ? "you" : nameOf(id)})`));
  return { score: row.score, passes: !!row.passes, near: !!row.near_miss, failed, scored: true };
}

export const personScore = (row: FeedRow, who: "me" | "partner") =>
  row.per_person?.[who === "me" ? myId() : partnerId()];

function scorable(row: FeedRow): ScorableListing {
  const building = row.hpd_open_violations == null && row.complaints_311_12mo == null ? null : {
    hpd_open_violations: row.hpd_open_violations, hpd_class_c_open: row.hpd_class_c_open,
    complaints_311_12mo: row.complaints_311_12mo, rent_stabilized: null,
  };
  return { ...row, amenities: row.amenities ?? {}, building, commutes: row.commutes ?? {} };
}

/** Score every listing locally with a candidate version of my criteria (for the editor preview). */
export function previewCounts(mine: Criterion[]) {
  const others = partnerCriteria().filter((c) => c.active);
  const minePass = { pass: 0, near: 0 }, both = { pass: 0 };
  const byOwner = groupByOwner([...mine.filter((c) => c.active).map((c) => ({ ...c, owner_id: myId() })), ...others]);
  for (const row of S.feed) {
    const p = scorePerson(mine.filter((c) => c.active), scorable(row));
    if (p.passes) minePass.pass++; else if (p.near_miss) minePass.near++;
    if (scoreListing(byOwner, scorable(row)).passes) both.pass++;
  }
  return { mine: minePass, both };
}

// ---------- places ----------
/** "Office", or "Noah's office" for the other person's place. */
export function placeName(p: Place) {
  return p.user_id === myId() ? p.label : `${partnerName()}'s ${p.label.charAt(0).toLowerCase()}${p.label.slice(1)}`;
}

/** Everything that can go on a criteria list, including a commute to each saved place. */
export function allFields(): FieldDef[] {
  const commutes: FieldDef[] = S.places.map((p) => ({
    key: "place:" + p.id, label: "Commute to " + placeName(p), field: "commute:" + p.id,
    operator: "within_minutes", value: 35, group: "Commute",
  }));
  return [...CATALOG, ...commutes];
}

export const isNewSinceVisit = (row: FeedRow) => S.lastVisit > 0 && Date.parse(row.first_seen_at) > S.lastVisit;
export const neighborhoods = () => {
  const counts = new Map<string, number>();
  for (const r of S.feed) if (r.neighborhood) counts.set(r.neighborhood, (counts.get(r.neighborhood) ?? 0) + 1);
  return counts;
};
