import {
  type ScorableListing, groupByOwner, scoreListing, scorePerson,
} from "../../supabase/functions/_shared/scoring.ts";
import type { Api } from "./api.ts";
import type { Criterion, FeedRow, Me, PersonScore, Profile, Rating, Verdict } from "./types.ts";
import { clone, store } from "./util.ts";

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
  draft: Criterion[];      // my list as being edited
  tab: Tab;
  lens: Lens;
  filter: Filter;
  sort: Sort;
  feedView: "list" | "map";
  shown: number;           // feed cards rendered so far
  openId: string | null;   // listing detail sheet
  bdWho: "me" | "partner";
  lastVisit: number;       // for "new since your last visit"
  loading: boolean;
  saving: boolean;
  error: string | null;
  sentLinkTo: string | null;
}

export const S = {} as State;

export function initState(api: Api) {
  Object.assign(S, {
    api, me: null, profiles: [], feed: [], ratings: [], criteria: [], draft: [],
    tab: store<Tab>("tab", "feed"), lens: store<Lens>("lens", "both"),
    filter: "passing", sort: store<Sort>("sort", "score"), feedView: store<"list" | "map">("feedView", "list"), shown: 40,
    openId: null, bdWho: "me", lastVisit: store<number>("lastVisit", 0),
    loading: true, saving: false, error: null, sentLinkTo: null,
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
export const draftDirty = () => JSON.stringify(myCriteria()) !== JSON.stringify(S.draft);
export function resetDraft() { S.draft = clone(myCriteria()); }

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
  return { ...row, amenities: row.amenities ?? {}, building: null, commutes: {} };
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

export const isNewSinceVisit = (row: FeedRow) => S.lastVisit > 0 && Date.parse(row.first_seen_at) > S.lastVisit;
export const neighborhoods = () => {
  const counts = new Map<string, number>();
  for (const r of S.feed) if (r.neighborhood) counts.set(r.neighborhood, (counts.get(r.neighborhood) ?? 0) + 1);
  return counts;
};
