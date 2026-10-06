// Database steps shared by ingest and rescore. Runs with the service role,
// so row-level security doesn't apply here.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type Building, type Criterion, type ScorableListing,
  groupByOwner, scoreListing,
} from "./scoring.ts";

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
