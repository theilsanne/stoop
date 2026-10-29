import type { AlertState } from "./push.ts";
import type { ScorableListing } from "../../supabase/functions/_shared/scoring.ts";
import type { Api } from "./api.ts";
import type { Criterion, FeedRow, Me, PersonScore, Place, Profile, Rating, Stamp, Verdict } from "./types.ts";
import { CATALOG, type FieldDef } from "./catalog.ts";
import { IMPORTANT_WEIGHT, type Level, withLevel } from "./criteria-edit.ts";
import { clone, save, store } from "./util.ts";
import { columnOf, waitingFor, type Column } from "./stages.ts";

export type Tab = "feed" | "pipeline" | "criteria" | "settings";
export type Lens = "both" | "me" | "partner";
export type Filter = "passing" | "near" | "other" | "stamped";
export type Sort = "score" | "newest" | "rent";
export type Liked = "all" | "me" | "partner" | "both"; // map: whose thumbs-up a listing needs

export interface State {
  api: Api;
  me: Me | null;
  profiles: Profile[];
  feed: FeedRow[];
  ratings: Rating[];
  stamps: Stamp[];         // "I really like this one", both people's
  criteria: Criterion[];   // both people's saved lists
  places: Place[];         // commute destinations, both people's
  draft: Criterion[];      // my list as being edited
  tab: Tab;
  lens: Lens;
  filter: Filter;
  sort: Sort;
  feedView: "list" | "map";
  mapLiked: Liked;         // the map shows every listing, or only those with a thumbs-up from you, your partner or both
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
  historyOpen: boolean;    // Criteria → Change history expanded (remembered on this device)
  infoOpen: Set<string>;   // Criteria rows with their (i) explanation open, by row key
  critFilter: "all" | "picks" | "differ"; // Criteria shows every feature, only the ones I've picked, or only where we differ
  alerts: AlertState;      // phone alerts on this device
}

export const S = {} as State;

/** The tab to open on: the one used last, except Compare, which now lives inside Criteria. */
function savedTab(): Tab {
  const t = store<string>("tab", "feed");
  return (t === "compare" ? "criteria" : t) as Tab;
}

export function initState(api: Api) {
  Object.assign(S, {
    api, me: null, profiles: [], feed: [], ratings: [], stamps: [], criteria: [], places: [], draft: [],
    tab: savedTab(), lens: "both",
    filter: "passing", sort: store<Sort>("sort", "score"), feedView: store<"list" | "map">("feedView", "list"),
    mapLiked: store<Liked>("mapLiked", "all"), whyOpen: new Set(), shown: 40,
    openId: null, bdWho: "me", lastVisit: store<number>("lastVisit", 0),
    loading: true, saving: false, busy: new Set(), error: null, sentLinkTo: null, alerts: "checking",
    critFilter: store<"all" | "picks" | "differ">("critFilter", "all"),
    historyOpen: store<boolean>("historyOpen", false),
    infoOpen: new Set(),
  } satisfies State);
}

// ---------- people ----------
export const myId = () => S.me?.id ?? "";
export const partner = (): Profile | null => S.profiles.find((p) => p.id !== myId()) ?? null;
export const partnerId = () => partner()?.id ?? "";
export const partnerName = () => partner()?.display_name || "Partner";
export const nameOf = (id: string) => (id === myId() ? "You" : id === partnerId() ? partnerName() : "Someone");

export const profileOf = (id: string): Profile | undefined => S.profiles.find((p) => p.id === id);

export const myCriteria = () => S.criteria.filter((c) => c.owner_id === myId());
export const partnerCriteria = () => S.criteria.filter((c) => c.owner_id === partnerId());
/**
 * The settings that matter, in a stable form: ignores key order, how the database
 * formats numbers, and the order neighborhoods were ticked in.
 */
export function settingsOf(list: Criterion[]) {
  // titles aren't editable, so they're left out: a title can only change on the server (a rename), never as an edit of yours
  return JSON.stringify(list.map((c) => [
    c.id, c.kind, c.field, c.operator, norm(c.value),
    Number(c.weight), Math.round(Number(c.near_miss_margin ?? 0) * 100), !!c.active,
  ]));
}
const norm = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : typeof v === "number" ? Number(v) : v ?? null);
export const draftDirty = () => settingsOf(myCriteria()) !== settingsOf(S.draft);

/** What the unsaved edits are, in words: "Availability changed, order changed, 1 added". */
export function draftChanges(): string {
  const saved = myCriteria(), byId = new Map(saved.map((c) => [c.id, c]));
  const one = (c: Criterion) => settingsOf([c]);
  const changed = S.draft.filter((c) => byId.has(c.id) && one(c) !== one(byId.get(c.id)!)).map((c) => c.label);
  const added = S.draft.filter((c) => !byId.has(c.id)).length;
  const removed = saved.filter((c) => !S.draft.some((d) => d.id === c.id)).length;
  const kept = S.draft.filter((c) => byId.has(c.id)).map((c) => c.id);
  const reordered = kept.join() !== saved.filter((c) => kept.includes(c.id)).map((c) => c.id).join();
  return [
    changed.length ? `${changed.join(", ")} changed` : "",
    reordered ? "order changed" : "",
    added ? `${added} added` : "",
    removed ? `${removed} removed` : "",
  ].filter(Boolean).join(", ");
}

// ---------- unsaved criteria edits ----------
// Kept on this device so they survive a reload, a new tab, or closing the app.
interface StoredDraft { user: string; base: string; draft: Criterion[]; at: number }

/** Start the draft over from what's saved. clearStored=false keeps any edits waiting on this device. */
export function resetDraft(clearStored = true) {
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
  // titles always come from what's saved (they can be renamed on the server, never edited here)
  const saved = new Map(myCriteria().map((c) => [c.id, c.label]));
  S.draft = clone(d.draft).map((c) => (saved.has(c.id) ? { ...c, label: saved.get(c.id)! } : c));
  if (draftDirty()) return "restored";
  resetDraft(); // nothing real was waiting: start clean
  return null;
}

// ---------- ratings ----------
export const ratingOf = (listingId: string, userId: string): Rating | undefined =>
  S.ratings.find((r) => r.listing_id === listingId && r.user_id === userId);
export const verdictOf = (listingId: string, userId: string): Verdict | null =>
  ratingOf(listingId, userId)?.verdict ?? null;

// ---------- stamps ----------
// Stamps are shown and counted, never scored: they don't touch the scoring rules.
export const stampedBy = (listingId: string, userId: string) =>
  !!userId && S.stamps.some((s) => s.listing_id === listingId && s.user_id === userId);

/** Which of you has stamped a listing. */
export const stampsOf = (listingId: string) => ({ mine: stampedBy(listingId, myId()), theirs: stampedBy(listingId, partnerId()) });

/** The pipeline column a listing is in, or null when it isn't on the board. */
export function columnFor(row: FeedRow): Column | null {
  const s = stampsOf(row.id);
  return columnOf(row.stage, s.mine, s.theirs);
}

/** Listings your partner has stamped that are still waiting for your stamp. */
export const waitingForMe = () => S.feed.filter((r) => {
  const s = stampsOf(r.id);
  return waitingFor(r.stage, s.mine, s.theirs) === "me";
});

/** Whether a listing has the thumbs-up(s) the map's filter asks for. */
export function likedBy(listingId: string, who: Liked) {
  const me = verdictOf(listingId, myId()) === "yes", them = verdictOf(listingId, partnerId()) === "yes";
  return who === "all" || (who === "me" ? me : who === "partner" ? them : me && them);
}

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

/** Every listing in my feed, in the shape scoring wants (for the Criteria page's live numbers). */
export const scorableRows = (): ScorableListing[] => S.feed.map(scorable);

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
    info: `The subway trip from the listing to ${placeName(p)}, door to door: the walk to a station, a wait of half the gap between trains, the ride, any transfers and the walk at the end, for a weekday morning. Listings without a time yet are skipped, not penalized.`,
  }));
  return [...CATALOG, ...commutes];
}

export const isNewSinceVisit = (row: FeedRow) => S.lastVisit > 0 && Date.parse(row.first_seen_at) > S.lastVisit;
export const neighborhoods = () => {
  const counts = new Map<string, number>();
  for (const r of S.feed) if (r.neighborhood) counts.set(r.neighborhood, (counts.get(r.neighborhood) ?? 0) + 1);
  return counts;
};

// ---------- how much each feature matters ----------
let newCount = 0;
const newId = () => `new-${Date.now()}-${newCount++}`;

/** Prefix on the key of a row that is my partner's own criterion, with no match on my list yet. */
export const THEIRS = "their:";

/** A criterion for a catalog feature, ready to go on my list. */
function newCriterion(def: FieldDef): Criterion {
  return {
    id: newId(), owner_id: myId(), label: def.label, kind: "want",
    field: def.field, operator: def.operator,
    // a new neighborhoods list starts with every neighborhood in your listings; untick the ones you don't want
    value: def.operator === "in" ? [...neighborhoods().keys()].sort() : structuredClone(def.value),
    weight: IMPORTANT_WEIGHT, near_miss_margin: null, active: true,
  };
}

/** My criterion for a catalog feature, if I've picked it. */
export const criterionFor = (def: Pick<FieldDef, "field" | "operator">) =>
  S.draft.find((c) => c.field === def.field && c.operator === def.operator);

/**
 * Set how much a feature matters to me. A feature you haven't touched gets its criterion on the
 * first pick. Skip turns a saved one off, keeping its settings; one that was never saved just goes.
 * Name a catalog feature by its key, or one of your own by its criterion id. A THEIRS id picks up
 * one of my partner's own criteria and puts a copy on my list.
 */
export function setLevel(target: { key?: string; id?: string }, level: Level) {
  const def = target.key ? allFields().find((d) => d.key === target.key) : undefined;
  const theirs = target.id?.startsWith(THEIRS) ? partnerCriteria().find((x) => THEIRS + x.id === target.id) : undefined;
  let c = theirs ? undefined : target.id ? S.draft.find((x) => x.id === target.id) : def && criterionFor(def);
  if (!c) {
    if (level === "skip" || (!def && !theirs)) return;
    c = theirs
      ? { ...clone(theirs), id: newId(), owner_id: myId(), kind: "want", weight: IMPORTANT_WEIGHT, active: true }
      : newCriterion(def!);
    S.draft.push(c);
  }
  const keep = c;
  if (level === "skip" && !myCriteria().some((x) => x.id === keep.id)) { S.draft = S.draft.filter((x) => x !== keep); return; }
  S.draft[S.draft.indexOf(keep)] = withLevel(keep, level, def?.unit === "money" ? 0.05 : null);
}
