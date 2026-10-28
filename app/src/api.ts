// Everything the app reads or writes goes through this interface.
// SupabaseApi talks to your project; DemoApi (demo.ts) runs on sample data.

import { createClient } from "@supabase/supabase-js";
import type {
  CriteriaChange, Criterion, EnrichResult, FeedRow, Me, PricePoint, Profile, Rating, Stage, Verdict,
} from "./types.ts";

export interface Api {
  readonly demo: boolean;
  me(): Promise<Me | null>;
  onAuthChange(cb: () => void): void;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  profiles(): Promise<Profile[]>;
  updateMyName(name: string): Promise<void>;

  feed(): Promise<FeedRow[]>;
  ratings(): Promise<Rating[]>;
  setRating(listingId: string, verdict: Verdict | null, note: string | null): Promise<void>;
  setStage(listingId: string, stage: Stage): Promise<void>;
  priceHistory(listingId: string): Promise<PricePoint[]>;

  criteria(): Promise<Criterion[]>;
  /** Write my draft list: insert new, update changed, delete removed. */
  saveMyCriteria(draft: Criterion[], saved: Criterion[]): Promise<void>;
  criteriaLog(): Promise<CriteriaChange[]>;
  /** Re-score every active listing on the server. */
  rescore(): Promise<{ rescored: number; passing: number }>;
  /** Look up building records for listings that don't have them (one batch). */
  enrich(): Promise<EnrichResult>;
}

const FEED_COLUMNS = [
  "id", "source_id", "url", "address", "unit", "neighborhood", "lat", "lng",
  "price", "net_effective_rent", "free_months", "lease_term_months", "no_fee",
  "beds", "baths", "sqft", "available_date", "amenities", "photos",
  "listed_at", "first_seen_at", "last_seen_at",
  "score", "passes", "near_miss", "failed", "per_person", "stage", "verdicts",
  "bbl", "hpd_open_violations", "hpd_class_c_open", "complaints_311_12mo", "building_checked_at",
].join(",");

const CRITERION_COLUMNS =
  "id,owner_id,label,kind,field,operator,value,weight,near_miss_margin,active,sort_order";

export const isNewId = (id: string) => id.startsWith("new-");

function fail(what: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const makeClient = (url: string, key: string) =>
  createClient(url, key, {
    db: { schema: "rentals" },
    // implicit flow: the magic link works even if it opens in a different browser than the one that asked
    auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true },
  });

export class SupabaseApi implements Api {
  readonly demo = false;
  private sb: ReturnType<typeof makeClient>;
  private user: Me | null = null;

  constructor(url: string, key: string) {
    this.sb = makeClient(url, key);
  }

  async me() {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    this.user = u ? { id: u.id, email: u.email ?? "" } : null;
    return this.user;
  }

  onAuthChange(cb: () => void) {
    this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") cb();
    });
  }

  async sendMagicLink(email: string) {
    const { error } = await this.sb.auth.signInWithOtp({
      email,
      options: {
        // back to wherever the app is being served from (Pages or localhost)
        emailRedirectTo: location.origin + import.meta.env.BASE_URL,
        shouldCreateUser: false, // only the two invited accounts can sign in
      },
    });
    fail("Sending the sign-in link", error);
  }

  async signOut() { await this.sb.auth.signOut(); }

  async profiles() {
    const { data, error } = await this.sb.from("profiles").select("id,display_name,notify_threshold");
    fail("Loading profiles", error);
    return data as Profile[];
  }

  async updateMyName(name: string) {
    const { error } = await this.sb.from("profiles").update({ display_name: name }).eq("id", this.user!.id);
    fail("Saving your name", error);
  }

  async feed() {
    const rows: FeedRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from("feed").select(FEED_COLUMNS)
        .order("first_seen_at", { ascending: false }).range(from, from + 999);
      fail("Loading listings", error);
      rows.push(...(data as unknown as FeedRow[]));
      if (data.length < 1000) break;
    }
    return rows;
  }

  async ratings() {
    const { data, error } = await this.sb.from("ratings").select("listing_id,user_id,verdict,note");
    fail("Loading ratings", error);
    return data as Rating[];
  }

  async setRating(listingId: string, verdict: Verdict | null, note: string | null) {
    const { error } = await this.sb.from("ratings").upsert(
      { listing_id: listingId, user_id: this.user!.id, verdict, note, updated_at: new Date().toISOString() },
      { onConflict: "listing_id,user_id" },
    );
    fail("Saving your rating", error);
  }

  async setStage(listingId: string, stage: Stage) {
    const { error } = await this.sb.from("tracking").upsert(
      { listing_id: listingId, stage, updated_by: this.user!.id, updated_at: new Date().toISOString() },
      { onConflict: "listing_id" },
    );
    fail("Saving the stage", error);
  }

  async priceHistory(listingId: string) {
    const { data, error } = await this.sb.from("price_history").select("price,seen_at")
      .eq("listing_id", listingId).order("seen_at");
    fail("Loading price history", error);
    return data as PricePoint[];
  }

  async criteria() {
    const { data, error } = await this.sb.from("criteria").select(CRITERION_COLUMNS).order("sort_order");
    fail("Loading criteria", error);
    return data as unknown as Criterion[];
  }

  async saveMyCriteria(draft: Criterion[], saved: Criterion[]) {
    const fields = (c: Criterion, i: number) => ({
      label: c.label, kind: c.kind, field: c.field, operator: c.operator, value: c.value,
      weight: c.weight, near_miss_margin: c.near_miss_margin, active: c.active, sort_order: i,
      updated_at: new Date().toISOString(),
    });
    const savedById = new Map(saved.map((c) => [c.id, c]));
    const draftIds = new Set(draft.map((c) => c.id));

    const inserts = draft.map((c, i) => ({ c, i })).filter(({ c }) => isNewId(c.id));
    if (inserts.length) {
      const { error } = await this.sb.from("criteria").insert(inserts.map(({ c, i }) => fields(c, i)));
      fail("Adding criteria", error);
    }
    for (const [i, c] of draft.entries()) {
      if (isNewId(c.id)) continue;
      const before = savedById.get(c.id);
      const after = fields(c, i);
      if (before && JSON.stringify({ ...fields(before, saved.indexOf(before)), updated_at: 0 })
          === JSON.stringify({ ...after, updated_at: 0 })) continue;
      const { error } = await this.sb.from("criteria").update(after).eq("id", c.id);
      fail(`Saving “${c.label}”`, error);
    }
    const removed = saved.filter((c) => !draftIds.has(c.id)).map((c) => c.id);
    if (removed.length) {
      const { error } = await this.sb.from("criteria").delete().in("id", removed);
      fail("Removing criteria", error);
    }
  }

  async criteriaLog() {
    const { data, error } = await this.sb.from("criteria_log").select("changed_by,changed_at,before,after")
      .order("changed_at", { ascending: false }).limit(40);
    fail("Loading change history", error);
    return data as CriteriaChange[];
  }

  async rescore() {
    const { data, error } = await this.sb.functions.invoke("rescore", { method: "POST" });
    fail("Re-scoring listings", error);
    return data as { rescored: number; passing: number };
  }

  async enrich() {
    const { data, error } = await this.sb.functions.invoke("enrich", { method: "POST" });
    fail("Looking up building records", error);
    return data as EnrichResult;
  }
}
