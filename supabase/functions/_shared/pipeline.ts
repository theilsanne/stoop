// Database steps shared by ingest and rescore. Runs with the service role,
// so row-level security doesn't apply here.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type Building, type Criterion, type ScorableListing,
  groupByOwner, scoreListing,
} from "./scoring.ts";
import { normalize } from "./normalize.ts";
import { type Fetch, lookupBbl, lookupBuilding } from "./buildings.ts";
import { type SubwayGraph, subwayCommute } from "./subway.ts";
import graphJson from "./subway-graph.json" with { type: "json" };
const SUBWAY = graphJson as unknown as SubwayGraph;

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "rentals" }, auth: { persistSession: false } },
  );
}

export function chunk<T>(xs: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type DB = ReturnType<typeof serviceClient>;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as NonNullable<T>;
}

const BUILDING_FRESH_DAYS = 14;

/**
 * Fill in building records for listings: look up each listing's BBL from its
 * address, then fetch HPD violations and 311 complaints for buildings not checked
 * in the last two weeks. Pass ids to do specific listings (ingest), or null to
 * work through all active listings that need it (backfill), up to `limit` each.
 */
export async function enrichBuildings(db: DB, ids: string[] | null, limit = 100, retryUnmatched = false) {
  const fetchFn = fetch as unknown as Fetch;
  const token = Deno.env.get("NYC_OPENDATA_TOKEN") || undefined;
  const cols = "id, address, bbl, zip:raw->>zipCode, zip2:raw->>propertyDetails_address_zipCode";
  type Row = { id: string; address: string | null; bbl: string | null; zip: string | null; zip2: string | null };
  const rows: Row[] = [];
  // addresses that didn't match before get another go (the matching may have improved)
  if (retryUnmatched) check(await db.from("listings").update({ bbl: null }).eq("bbl", "").eq("status", "active"), "reset unmatched");
  if (ids) {
    for (const part of chunk(ids)) rows.push(...check(await db.from("listings").select(cols).in("id", part), "load listings") as Row[]);
  } else {
    for (let from = 0; ; from += 1000) {
      const page = check(await db.from("listings").select(cols).eq("status", "active").order("id").range(from, from + 999), "load listings") as Row[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
  }

  // 1. address → BBL. bbl = "" marks an address the lookup couldn't match, so it isn't retried forever.
  const needBbl = rows.filter((r) => r.bbl == null && r.address).slice(0, limit);
  let geocoded = 0, unmatched = 0, lookupFailed = 0;
  const errors: string[] = [];
  for (const part of chunk(needBbl, 8)) {
    await Promise.all(part.map(async (r) => {
      const m = await lookupBbl(fetchFn, r.address!, r.zip ?? r.zip2);
      if (m.error) { lookupFailed++; errors.push(`Address lookup failed: ${m.error}`); return; } // try again next time
      r.bbl = m.bbl ?? "";
      if (m.bbl) geocoded++; else { unmatched++; errors.push(`${r.address}: ${m.why}`); }
      check(await db.from("listings").update({ bbl: r.bbl }).eq("id", r.id), "save bbl");
    }));
  }
  if (unmatched || lookupFailed) console.warn("enrich: address problems", JSON.stringify(errors.slice(0, 10)));

  // 2. BBL → building record, for buildings not checked recently
  const bbls = [...new Set(rows.map((r) => r.bbl).filter((b): b is string => !!b))];
  const fresh = new Set<string>();
  const cutoff = new Date(Date.now() - BUILDING_FRESH_DAYS * 24 * 3600e3).toISOString();
  for (const part of chunk(bbls)) {
    const known = check(await db.from("buildings").select("bbl").in("bbl", part).gt("refreshed_at", cutoff), "load buildings") as { bbl: string }[];
    for (const b of known) fresh.add(b.bbl);
  }
  const toCheck = bbls.filter((b) => !fresh.has(b)).slice(0, limit);
  let checked = 0;
  for (const part of chunk(toCheck, 6)) {
    const records = await Promise.all(part.map((bbl) => lookupBuilding(fetchFn, bbl, token)));
    for (const r of records) errors.push(...r.errors);
    const saveable = records.filter((r) => r.hpd_open_violations != null || r.complaints_311_12mo != null);
    if (saveable.length) {
      check(await db.from("buildings").upsert(saveable.map(({ errors: _e, ...b }) => ({ ...b, refreshed_at: new Date().toISOString() })), { onConflict: "bbl" }), "save buildings");
    }
    checked += saveable.length;
  }

  const remaining = (lookupFailed ? 0 : rows.filter((r) => r.bbl == null && r.address).length)
    + Math.max(0, bbls.filter((b) => !fresh.has(b)).length - toCheck.length);
  return {
    geocoded, unmatched, lookup_failed: lookupFailed, buildings_checked: checked, remaining,
    errors: [...new Set(errors)].slice(0, 5),
  };
}

const COMMUTE_FRESH_DAYS = 45; // the subway network is rebuilt monthly; refresh times now and then

/**
 * Subway commute times from listings to every saved place, worked out here from the
 * MTA timetable (see subway.ts). No outside service, so a whole batch is quick.
 * Only pairs with no answer yet (or an old one) are worked out; redo starts over.
 */
export async function computeCommutes(db: DB, ids: string[] | null, limit = 2000, redo = false) {
  const places = (check(await db.from("places").select("id, lat, lng"), "load places") as
    { id: string; lat: number | null; lng: number | null }[]).filter((p) => p.lat != null && p.lng != null);
  if (!places.length) return { computed: 0, failed: 0, remaining: 0, errors: [] as string[] };
  if (redo) check(await db.from("commutes").delete().gte("computed_at", "1970-01-01"), "clear commutes");

  type L = { id: string; lat: number | null; lng: number | null };
  const listings: L[] = [];
  if (ids) {
    for (const part of chunk(ids)) listings.push(...check(await db.from("listings").select("id, lat, lng").in("id", part), "load listings") as L[]);
  } else {
    for (let from = 0; ; from += 1000) {
      const page = check(await db.from("listings").select("id, lat, lng").eq("status", "active").order("id").range(from, from + 999), "load listings") as L[];
      listings.push(...page);
      if (page.length < 1000) break;
    }
  }
  const located = listings.filter((l) => l.lat != null && l.lng != null);

  const known = new Set<string>();
  const cutoff = new Date(Date.now() - COMMUTE_FRESH_DAYS * 24 * 3600e3).toISOString();
  for (const part of chunk(located.map((l) => l.id))) {
    const rows = check(await db.from("commutes").select("listing_id, place_id").in("listing_id", part).gt("computed_at", cutoff), "load commutes") as { listing_id: string; place_id: string }[];
    for (const r of rows) known.add(r.listing_id + "|" + r.place_id);
  }
  const todo = located.flatMap((l) => places.filter((p) => !known.has(l.id + "|" + p.id)).map((p) => ({ l, p })));
  const batch = todo.slice(0, limit);

  let failed = 0;
  const now = new Date().toISOString();
  const rows = batch.flatMap(({ l, p }) => {
    const trip = subwayCommute(SUBWAY, { lat: l.lat!, lng: l.lng! }, { lat: p.lat!, lng: p.lng! });
    if (!trip) { failed++; return []; }
    // mode holds the route, e.g. "Walk 4 → A → Walk 6"
    return [{ listing_id: l.id, place_id: p.id, minutes: trip.minutes, mode: trip.route, computed_at: now }];
  });
  for (const part of chunk(rows, 500)) check(await db.from("commutes").upsert(part, { onConflict: "listing_id,place_id" }), "save commutes");
  return { computed: rows.length, failed, remaining: todo.length - batch.length, errors: failed ? [`${failed} trips had no subway or walking route`] : [] };
}

/**
 * Re-derive amenity flags for active listings from the saved scraper item (raw),
 * so detection rules added later (e.g. garden level) apply to listings already stored.
 * Only rows whose flags changed are written. Returns how many changed.
 */
export async function refreshAmenities(db: DB): Promise<number> {
  const rows: { id: string; source: string; amenities: Record<string, boolean>; raw: Record<string, unknown> | null }[] = [];
  for (let from = 0; ; from += 500) {
    const page = check(
      await db.from("listings").select("id, source, amenities, raw").eq("status", "active").order("id").range(from, from + 499),
      "load listings for refresh",
    ) as typeof rows;
    rows.push(...page);
    if (page.length < 500) break;
  }
  const changed = rows.flatMap((r) => {
    if (!r.raw) return [];
    const next = normalize(r.raw, r.source)?.amenities;
    return next && JSON.stringify(next) !== JSON.stringify(r.amenities ?? {}) ? [{ id: r.id, amenities: next }] : [];
  });
  for (const part of chunk(changed, 20)) {
    await Promise.all(part.map(async (c) => {
      check(await db.from("listings").update({ amenities: c.amenities }).eq("id", c.id), "update amenities");
    }));
  }
  return changed.length;
}

/**
 * Score the given listings (or every active listing when ids is null)
 * against both people's current criteria, and save the results.
 * Returns the combined scores keyed by listing id.
 */
export async function scoreAndStore(db: DB, ids: string[] | null) {
  const criteria = check(
    await db.from("criteria").select("*").eq("active", true),
    "load criteria",
  ) as Criterion[];
  const byOwner = groupByOwner(criteria);

  // listings
  const listings: Record<string, unknown>[] = [];
  if (ids) {
    for (const part of chunk(ids)) {
      listings.push(...check(await db.from("listings").select("*").in("id", part), "load listings"));
    }
  } else {
    // Supabase returns at most 1,000 rows per request, so page through
    for (let from = 0; ; from += 1000) {
      const page = check(
        await db.from("listings").select("*").eq("status", "active").order("id").range(from, from + 999),
        "load listings",
      ) as Record<string, unknown>[];
      listings.push(...page);
      if (page.length < 1000) break;
    }
  }
  if (!listings.length) return {};

  // building records, by BBL
  const bbls = [...new Set(listings.map((l) => l.bbl).filter(Boolean))] as string[];
  const buildings: Record<string, Building> = {};
  for (const part of chunk(bbls)) {
    const rows = check(await db.from("buildings").select("*").in("bbl", part), "load buildings");
    for (const b of rows as (Building & { bbl: string })[]) buildings[b.bbl] = b;
  }

  // commutes, by listing then place
  const commutes: Record<string, Record<string, number>> = {};
  for (const part of chunk(listings.map((l) => l.id as string))) {
    const rows = check(
      await db.from("commutes").select("listing_id, place_id, minutes").in("listing_id", part),
      "load commutes",
    );
    for (const c of rows as { listing_id: string; place_id: string; minutes: number | null }[]) {
      if (c.minutes == null) continue;
      (commutes[c.listing_id] ??= {})[c.place_id] = c.minutes;
    }
  }

  const now = new Date().toISOString();
  const results: Record<string, ReturnType<typeof scoreListing>> = {};
  const rows = listings.map((l) => {
    const s: ScorableListing = {
      ...(l as unknown as ScorableListing),
      amenities: (l.amenities as Record<string, boolean>) ?? {},
      building: l.bbl ? buildings[l.bbl as string] ?? null : null,
      commutes: commutes[l.id as string] ?? {},
    };
    const r = scoreListing(byOwner, s);
    results[l.id as string] = r;
    return {
      listing_id: l.id, score: r.score, passes: r.passes, near_miss: r.near_miss,
      failed: r.failed, per_person: r.per_person, computed_at: now,
    };
  });

  for (const part of chunk(rows, 500)) {
    check(await db.from("scores").upsert(part, { onConflict: "listing_id" }), "save scores");
  }
  return results;
}
