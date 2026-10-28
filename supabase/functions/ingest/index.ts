// ingest: Apify calls this when a scraper run succeeds.
//
// 1. Check the shared secret header (Apify can't send a Supabase login).
// 2. Download the run's dataset from Apify.
// 3. Normalize each item and upsert it into rentals.listings.
// 4. Mark listings not seen for OFF_MARKET_DAYS (default 30) as off-market.
// 5. Score the listings from this run and save the scores.
// 6. Work out which ones deserve an alert (sending comes with web push).
//
// Deploy with:  supabase functions deploy ingest --no-verify-jwt
// Secrets:      APIFY_TOKEN, WEBHOOK_SECRET

import { chunk, scoreAndStore, serviceClient } from "../_shared/pipeline.ts";
import { normalize, type ListingRow } from "../_shared/normalize.ts";

// Capped runs (Apify's free plan returns 50 per run) only fetch the newest listings,
// so not appearing in one doesn't mean a listing is gone. Default to a long window;
// once full pulls run weekly, set the OFF_MARKET_DAYS secret to 8.
const OFF_MARKET_DAYS = Number(Deno.env.get("OFF_MARKET_DAYS")) || 30;
const OFF_MARKET_AFTER_HOURS = OFF_MARKET_DAYS * 24;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function fetchDataset(datasetId: string, token: string) {
  const items: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items` +
      `?clean=true&format=json&limit=1000&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Apify dataset ${datasetId}: HTTP ${res.status}`);
    const page = await res.json();
    items.push(...page);
    if (page.length < 1000) break;
  }
  return items;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  if (!secret || !safeEqual(req.headers.get("x-webhook-secret") ?? "", secret)) {
    return json({ error: "Wrong or missing x-webhook-secret header" }, 401);
  }

  // Apify's default webhook payload carries the run as `resource`.
  // For manual testing you can also POST {"datasetId": "..."} or {"items": [...]}.
  const body = await req.json().catch(() => ({}));
  const datasetId = body?.resource?.defaultDatasetId ?? body?.datasetId ?? null;
  let items: Record<string, unknown>[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    if (!datasetId) return json({ error: "No resource.defaultDatasetId, datasetId or items in the body" }, 400);
    const token = Deno.env.get("APIFY_TOKEN");
    if (!token) return json({ error: "APIFY_TOKEN secret is not set" }, 500);
    items = await fetchDataset(datasetId, token);
  }

  const db = serviceClient();

  // normalize, and keep one row per listing (the same listing can show up in two searches)
  const byKey = new Map<string, ListingRow>();
  let skipped = 0;
  for (const item of items) {
    const row = normalize(item);
    if (!row) { skipped++; continue; }
    byKey.set(`${row.source}|${row.source_id}`, row);
  }
  const rows = [...byKey.values()];

  // what we already had, to spot new listings and price drops
  const before = new Map<string, { id: string; price: number | null }>();
  for (const part of chunk(rows.map((r) => r.source_id))) {
    const { data, error } = await db.from("listings")
      .select("id, source_id, price").eq("source", "streeteasy").in("source_id", part);
    if (error) return json({ error: `load existing: ${error.message}` }, 500);
    for (const l of data) before.set(l.source_id, { id: l.id, price: l.price });
  }

  // upsert; first_seen_at is left out so it keeps its original value
  const now = new Date().toISOString();
  const touched: { id: string; source_id: string; price: number }[] = [];
  for (const part of chunk(rows, 200)) {
    const { data, error } = await db.from("listings")
      .upsert(part.map((r) => ({ ...r, status: "active", last_seen_at: now })), { onConflict: "source,source_id" })
      .select("id, source_id, price");
    if (error) return json({ error: `save listings: ${error.message}` }, 500);
    touched.push(...data);
  }

  // anything not seen recently has probably been rented
  const cutoff = new Date(Date.now() - OFF_MARKET_AFTER_HOURS * 3600e3).toISOString();
  const { count: wentOff, error: sweepErr } = await db.from("listings")
    .update({ status: "off_market" }, { count: "exact" })
    .eq("status", "active").lt("last_seen_at", cutoff);
  if (sweepErr) return json({ error: `off-market sweep: ${sweepErr.message}` }, 500);

  // score this run's listings
  const scores = await scoreAndStore(db, touched.map((t) => t.id));

  // who would get an alert: new + passes both of you + at or above the lower of your thresholds
  const { data: profiles } = await db.from("profiles").select("notify_threshold");
  const threshold = Math.min(...(profiles ?? []).map((p) => p.notify_threshold), 70);
  const newIds = touched.filter((t) => !before.has(t.source_id)).map((t) => t.id);
  const drops = touched.filter((t) => {
    const old = before.get(t.source_id)?.price;
    return old != null && t.price < old;
  }).map((t) => t.id);
  const alertable = newIds.filter((id) => scores[id]?.passes && scores[id].score >= threshold);

  // Sending comes next (web push). Until then, the alerts are only reported here.
  const summary = {
    items: items.length, skipped_unusable: skipped, saved: touched.length,
    new: newIds.length, price_drops: drops.length, went_off_market: wentOff ?? 0,
    would_alert: alertable.length,
  };
  console.log("ingest", JSON.stringify(summary));
  return json(summary);
});
