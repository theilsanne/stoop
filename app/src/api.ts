// Everything the app reads or writes goes through this interface.
// SupabaseApi talks to your project; DemoApi (demo.ts) runs on sample data.

import { createClient } from "@supabase/supabase-js";
import type {
  CommuteResult, CriteriaChange, Criterion, EnrichResult, FeedRow, Me, Place, PricePoint, Profile, Rating, Stage, Stamp, Verdict,
} from "./types.ts";

export interface TestResult { phones: number; sent: number; failed: number; removed: number; errors: string[] }

export interface Api {
  readonly demo: boolean;
  me(): Promise<Me | null>;
  onAuthChange(cb: () => void): void;
  sendMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  profiles(): Promise<Profile[]>;
  updateMyName(name: string): Promise<void>;
  /** Save my profile photo (a square JPEG from avatar.ts). Replaces the last one. */
  setAvatar(image: Blob): Promise<void>;
  removeAvatar(): Promise<void>;

  feed(): Promise<FeedRow[]>;
  ratings(): Promise<Rating[]>;
  setRating(listingId: string, verdict: Verdict | null, note: string | null): Promise<void>;
  stamps(): Promise<Stamp[]>;
  /** Stamp a listing as one I really like, or take my stamp back. */
  setStamp(listingId: string, stamped: boolean): Promise<void>;
  setStage(listingId: string, stage: Stage): Promise<void>;
  priceHistory(listingId: string): Promise<PricePoint[]>;

  criteria(): Promise<Criterion[]>;
  /** Write my draft list: insert new, update changed, delete removed. */
  saveMyCriteria(draft: Criterion[], saved: Criterion[]): Promise<void>;
  criteriaLog(): Promise<CriteriaChange[]>;
  /** Re-score every active listing on the server. */
  rescore(): Promise<{ rescored: number; passing: number }>;
  /** Look up building records for listings that don't have them (one batch). */
  enrich(retryUnmatched?: boolean): Promise<EnrichResult>;

  places(): Promise<Place[]>;
  /** Look the address up (NYC only) and save it as one of my places. */
  addPlace(label: string, address: string): Promise<Place>;
  removePlace(id: string): Promise<void>;
  /** Work out subway commute times to places (redo: start over). */
  commute(redo?: boolean): Promise<CommuteResult>;
  /** The route behind each commute time for one listing, by place id ("Walk 4 → A → Walk 6"). */
  commuteRoutes(listingId: string): Promise<Record<string, string>>;

  /** Phone alerts: the server's public key to subscribe with, saving this phone, and a test. */
  alertsKey(): Promise<string>;
  savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  removePushSubscription(endpoint: string): Promise<void>;
  testAlert(): Promise<TestResult>;
  /** Alert me about new listings scoring at least this. */
  setAlertThreshold(n: number): Promise<void>;
}

/** NYC address → coordinates with NYC Planning's GeoSearch (free, no key). */
export async function geocodeNyc(address: string): Promise<{ lat: number; lng: number; label: string }> {
  const res = await fetch(`https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(address)}&size=1`);
  if (!res.ok) throw new Error("The address lookup didn't respond. Try again in a minute.");
  const body = await res.json() as { features?: { geometry?: { coordinates?: [number, number] }; properties?: { label?: string; confidence?: number } }[] };
  const f = body.features?.[0];
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (lat == null || lng == null || (f?.properties?.confidence ?? 1) < 0.6) {
    throw new Error("Couldn't find that address in New York City. Try the street address with the borough, e.g. “111 8th Ave, Manhattan”.");
  }
  return { lat, lng, label: f?.properties?.label ?? address };
}

const FEED_COLUMNS = [
  "id", "source_id", "url", "address", "unit", "neighborhood", "lat", "lng",
  "price", "net_effective_rent", "free_months", "lease_term_months", "no_fee",
  "beds", "baths", "sqft", "available_date", "amenities", "photos",
  "listed_at", "first_seen_at", "last_seen_at",
  "score", "passes", "near_miss", "failed", "per_person", "stage", "verdicts",
  "bbl", "hpd_open_violations", "hpd_class_c_open", "complaints_311_12mo", "building_checked_at", "commutes",
].join(",");

const CRITERION_COLUMNS =
  "id,owner_id,label,kind,field,operator,value,weight,near_miss_margin,active,sort_order";

export const isNewId = (id: string) => id.startsWith("new-");

const AVATAR_LINK_SECONDS = 7 * 24 * 3600; // profile photo links, long enough for an open tab

function fail(what: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Like fail, for edge functions: shows the function's own error message when it sent one. */
async function failFn(what: string, data: unknown, error: { message: string; context?: unknown } | null) {
  if (!error) {
    const msg = (data as { error?: string } | null)?.error;
    if (msg) throw new Error(`${what}: ${msg}`);
    return;
  }
  let msg = error.message;
  const res = error.context as Response | undefined;
  if (res && typeof res.json === "function") {
    try { msg = (await res.clone().json()).error ?? msg; } catch { /* not JSON */ }
  }
  throw new Error(`${what}: ${msg}`);
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
    const { data, error } = await this.sb.from("profiles").select("id,display_name,notify_threshold,avatar_path");
    fail("Loading profiles", error);
    const rows = data as (Omit<Profile, "avatar_url"> & { avatar_path: string | null })[];
    // photos are private: hand out links that last a week. A photo that can't be signed shows initials instead.
    const paths = rows.map((r) => r.avatar_path).filter((p): p is string => !!p);
    const links = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await this.sb.storage.from("avatars").createSignedUrls(paths, AVATAR_LINK_SECONDS);
      for (const s of signed ?? []) if (s.path && s.signedUrl) links.set(s.path, s.signedUrl);
    }
    return rows.map(({ avatar_path, ...p }) => ({ ...p, avatar_url: avatar_path ? links.get(avatar_path) ?? null : null }));
  }

  async updateMyName(name: string) {
    const { error } = await this.sb.from("profiles").update({ display_name: name }).eq("id", this.user!.id);
    fail("Saving your name", error);
  }

  private async currentAvatarPath() {
    const { data, error } = await this.sb.from("profiles").select("avatar_path").eq("id", this.user!.id).single();
    fail("Reading your profile", error);
    return (data as { avatar_path: string | null }).avatar_path;
  }

  async setAvatar(image: Blob) {
    const uid = this.user!.id;
    const old = await this.currentAvatarPath();
    // a new file name each time, so nothing cached under the old photo is shown again
    const path = `${uid}/${Date.now()}.jpg`;
    const { error: upErr } = await this.sb.storage.from("avatars").upload(path, image, { contentType: "image/jpeg", cacheControl: "3600" });
    fail("Uploading your photo", upErr);
    const { error } = await this.sb.from("profiles").update({ avatar_path: path }).eq("id", uid);
    fail("Saving your photo", error);
    if (old) await this.sb.storage.from("avatars").remove([old]); // the old file is only cleaned up, so a failure here is harmless
  }

  async removeAvatar() {
    const old = await this.currentAvatarPath();
    const { error } = await this.sb.from("profiles").update({ avatar_path: null }).eq("id", this.user!.id);
    fail("Removing your photo", error);
    if (old) await this.sb.storage.from("avatars").remove([old]);
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

  async stamps() {
    const { data, error } = await this.sb.from("stamps").select("listing_id,user_id");
    fail("Loading stamps", error);
    return data as Stamp[];
  }

  async setStamp(listingId: string, stamped: boolean) {
    if (stamped) {
      const { error } = await this.sb.from("stamps").upsert(
        { listing_id: listingId, user_id: this.user!.id },
        { onConflict: "listing_id,user_id", ignoreDuplicates: true },
      );
      fail("Stamping this listing", error);
    } else {
      const { error } = await this.sb.from("stamps").delete().eq("listing_id", listingId).eq("user_id", this.user!.id);
      fail("Taking your stamp back", error);
    }
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

  async places() {
    const { data, error } = await this.sb.from("places").select("id,user_id,label,address,lat,lng").order("label");
    fail("Loading places", error);
    return data as Place[];
  }

  async addPlace(label: string, address: string) {
    const g = await geocodeNyc(address);
    const { data, error } = await this.sb.from("places")
      .insert({ user_id: this.user!.id, label, address: g.label, lat: g.lat, lng: g.lng })
      .select("id,user_id,label,address,lat,lng").single();
    fail("Saving the place", error);
    return data as Place;
  }

  async removePlace(id: string) {
    const { error } = await this.sb.from("places").delete().eq("id", id);
    fail("Removing the place", error);
  }

  async commuteRoutes(listingId: string) {
    const { data, error } = await this.sb.from("commutes").select("place_id,mode").eq("listing_id", listingId);
    fail("Loading commute routes", error);
    return Object.fromEntries((data as { place_id: string; mode: string }[]).filter((r) => r.mode && r.mode !== "transit").map((r) => [r.place_id, r.mode]));
  }

  async commute(redo = false) {
    const { data, error } = await this.sb.functions.invoke("commute", { body: { redo } });
    fail("Working out commute times", error);
    return data as CommuteResult;
  }

  async enrich(retryUnmatched = false) {
    const { data, error } = await this.sb.functions.invoke("enrich", { body: { retry: retryUnmatched } });
    fail("Looking up building records", error);
    return data as EnrichResult;
  }

  async alertsKey() {
    const { data, error } = await this.sb.functions.invoke("alerts", { body: { action: "key" } });
    await failFn("Turning on alerts", data, error);
    return (data as { publicKey: string }).publicKey;
  }

  async savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }) {
    const { error } = await this.sb.from("push_subscriptions")
      .upsert({ ...sub, user_id: this.user!.id }, { onConflict: "endpoint" });
    fail("Saving this phone for alerts", error);
  }

  async removePushSubscription(endpoint: string) {
    const { error } = await this.sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
    fail("Turning off alerts", error);
  }

  async testAlert() {
    const { data, error } = await this.sb.functions.invoke("alerts", { body: { action: "test" } });
    await failFn("Sending a test alert", data, error);
    return data as TestResult;
  }

  async setAlertThreshold(n: number) {
    const { error } = await this.sb.from("profiles").update({ notify_threshold: n }).eq("id", this.user!.id);
    fail("Saving your alert setting", error);
  }
}
