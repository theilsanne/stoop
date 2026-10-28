// Web push alerts. Each phone that taps "Turn on alerts" saves a push subscription;
// we send to it with VAPID keys (set as Supabase secrets VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT). No third-party service: Chrome's own push
// service delivers it.
//
// What gets sent, after each ingest:
//  - New listings that pass both of your dealbreakers and score at or above your
//    alert threshold (each of you sets your own in Settings). More than three at once
//    become one summary alert.
//  - Price drops on listings either of you has said Yes or Maybe to, or moved into
//    the pipeline.
// The alerts table records what was sent, so nothing is sent twice.

import webpush from "npm:web-push@3.6.7";
import type { DB } from "./pipeline.ts";

export const APP_URL = Deno.env.get("APP_URL") ?? "https://theilsanne.github.io/stoop/";

export interface Message {
  title: string;
  body: string;
  /** opens the app here when tapped */
  url: string;
  /** big picture shown on Android */
  image?: string;
  /** a newer alert with the same tag replaces the older one */
  tag?: string;
}

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

let ready: boolean | null = null;
function configured() {
  if (ready != null) return ready;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  ready = !!(pub && priv);
  if (ready) webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:stoop@example.com", pub!, priv!);
  return ready;
}

export const vapidPublicKey = () => Deno.env.get("VAPID_PUBLIC_KEY") ?? null;

/** Send to every phone of the given people. Dead subscriptions (phone unsubscribed, app removed) are deleted. */
export async function sendTo(db: DB, userIds: string[], msg: Message) {
  if (!configured()) return { sent: 0, failed: 0, errors: ["VAPID keys aren't set"] };
  if (!userIds.length) return { sent: 0, failed: 0, errors: [] as string[] };
  const { data, error } = await db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", userIds);
  if (error) throw new Error(`load subscriptions: ${error.message}`);
  let sent = 0, failed = 0;
  const errors: string[] = [], dead: string[] = [];
  await Promise.all((data as Sub[]).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { TTL: 6 * 3600, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(s.id);
      else { failed++; errors.push(`${status ?? ""} ${e instanceof Error ? e.message : String(e)}`.trim()); }
    }
  }));
  if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);
  return { sent, failed, removed: dead.length, errors: [...new Set(errors)].slice(0, 3) };
}

const money = (n: number | null) => (n == null ? "" : "$" + n.toLocaleString("en-US"));
const bedsText = (b: number | null) => (b == null ? "" : b === 0 ? "Studio" : `${b} bd`);

type Listing = {
  id: string; address: string | null; unit: string | null; neighborhood: string | null; price: number | null;
  net_effective_rent: number | null; beds: number | null; photos: string[] | null;
};

/** Mark alerts as sent; returns the listing ids that hadn't been sent before. */
async function claim(db: DB, rows: { listing_id: string; reason: string }[]) {
  if (!rows.length) return new Set<string>();
  const { data, error } = await db.from("alerts")
    .upsert(rows.map((r) => ({ ...r, channel: "web_push" })), { onConflict: "listing_id,channel,reason", ignoreDuplicates: true })
    .select("listing_id");
  if (error) throw new Error(`record alerts: ${error.message}`);
  return new Set((data ?? []).map((r: { listing_id: string }) => r.listing_id));
}

const openUrl = (id: string) => `${APP_URL}?open=${encodeURIComponent(id)}`;
const photo = (l: Listing) => l.photos?.[0]?.replace(/-full\.(webp|jpg|jpeg|png)$/i, "-p_e.$1");

/**
 * After an ingest: alert each of you about new listings that pass and clear your
 * threshold, and about price drops on listings you're interested in.
 */
export async function sendAlerts(
  db: DB,
  newIds: string[],
  drops: { id: string; from: number; to: number }[],
  scores: Record<string, { passes: boolean; score: number }>,
) {
  if (!configured()) return { skipped: "VAPID keys aren't set" };
  const { data: people } = await db.from("profiles").select("id, notify_threshold");
  const profiles = (people ?? []) as { id: string; notify_threshold: number }[];
  if (!profiles.length) return { sent: 0 };

  const ids = [...new Set([...newIds, ...drops.map((d) => d.id)])];
  const { data: rows } = ids.length
    ? await db.from("listings").select("id,address,unit,neighborhood,price,net_effective_rent,beds,photos").in("id", ids)
    : { data: [] };
  const byId = new Map(((rows ?? []) as Listing[]).map((l) => [l.id, l]));
  let sent = 0;

  // 1. new listings that pass for both of you
  const passing = newIds.filter((id) => scores[id]?.passes && byId.has(id));
  const fresh = await claim(db, passing.map((id) => ({ listing_id: id, reason: "new_high_score" })));
  for (const p of profiles) {
    const mine = passing.filter((id) => fresh.has(id) && scores[id].score >= p.notify_threshold)
      .sort((a, b) => scores[b].score - scores[a].score);
    if (!mine.length) continue;
    if (mine.length > 3) {
      const top = byId.get(mine[0])!;
      const r = await sendTo(db, [p.id], {
        title: `${mine.length} new listings pass for both of you`,
        body: `Top: ${top.address} · ${money(top.net_effective_rent ?? top.price)} · score ${scores[mine[0]].score}`,
        url: APP_URL, image: photo(top), tag: "new-batch",
      });
      sent += r.sent;
      continue;
    }
    for (const id of mine) {
      const l = byId.get(id)!;
      const r = await sendTo(db, [p.id], {
        title: `New: ${l.address}${l.unit ? " " + l.unit : ""} · ${scores[id].score}`,
        body: [money(l.net_effective_rent ?? l.price), bedsText(l.beds), l.neighborhood].filter(Boolean).join(" · "),
        url: openUrl(id), image: photo(l), tag: id,
      });
      sent += r.sent;
    }
  }

  // 2. price drops on listings you're interested in (said Yes or Maybe, or in the pipeline)
  if (drops.length) {
    const dropIds = drops.map((d) => d.id);
    const [{ data: liked }, { data: tracked }] = await Promise.all([
      db.from("ratings").select("listing_id").in("listing_id", dropIds).in("verdict", ["yes", "maybe"]),
      db.from("tracking").select("listing_id").in("listing_id", dropIds).neq("stage", "new"),
    ]);
    const interesting = new Set([...(liked ?? []), ...(tracked ?? [])].map((r: { listing_id: string }) => r.listing_id));
    const mine = drops.filter((d) => interesting.has(d.id) && byId.has(d.id));
    // one alert per listing per new price
    const freshDrops = new Set<string>();
    for (const d of mine) {
      const got = await claim(db, [{ listing_id: d.id, reason: `price_drop:${d.to}` }]);
      if (got.has(d.id)) freshDrops.add(d.id);
    }
    for (const d of mine.filter((x) => freshDrops.has(x.id))) {
      const l = byId.get(d.id)!;
      const r = await sendTo(db, profiles.map((p) => p.id), {
        title: `Price drop: ${l.address}${l.unit ? " " + l.unit : ""}`,
        body: `${money(d.from)} → ${money(d.to)} (−${money(d.from - d.to)})${l.neighborhood ? " · " + l.neighborhood : ""}`,
        url: openUrl(d.id), image: photo(l), tag: d.id + ":drop",
      });
      sent += r.sent;
    }
  }
  return { sent, new_alerted: fresh.size };
}
