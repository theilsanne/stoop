// The weekly re-check: ask Apify again about the listings you two care about (stamped, or moved
// along the pipeline), so a rented one is marked gone and a live one isn't swept off the feed.
//
// It rides on ingest: after each normal pull, ingest calls maybeRecheck. If the recheck task last
// ran over a week ago, it starts that task with those listings' links. The task's results come back
// to ingest through a webhook set here, and that ingest sees a recheck that just ran, so it stops.
//
// Secret: RECHECK_TASK, the Apify task to run (its id, or "username~task-name"). Unset: no re-checks.
// The task is the StreetEasy scraper with monitoring mode off and no webhook of its own.

import type { DB } from "./pipeline.ts";

/** Pipeline stages still in play. New is the feed; won and passed are done with. */
export const RECHECK_STAGES = ["shortlisted", "tour_requested", "toured", "applied"];
export const RECHECK_EVERY_DAYS = 7;
/** Listings not seen for this long aren't asked about any more. */
export const RECHECK_WITHIN_DAYS = 60;

/** Is a re-check due, given when the last one started (null: never)? A little slack so a weekly schedule doesn't slip a day. */
export function recheckDue(lastStartedAt: string | null, now = Date.now()) {
  if (!lastStartedAt) return true;
  const t = Date.parse(lastStartedAt);
  return Number.isNaN(t) || now - t >= (RECHECK_EVERY_DAYS - 0.5) * 86400e3;
}

const API = "https://api.apify.com/v2";

export async function maybeRecheck(db: DB, opts: { token: string; secret: string; ingestUrl: string; task: string }) {
  const task = encodeURIComponent(opts.task);
  const auth = { Authorization: `Bearer ${opts.token}` };

  const last = await fetch(`${API}/actor-tasks/${task}/runs?desc=1&limit=1`, { headers: auth });
  if (!last.ok) throw new Error(`Apify task ${opts.task}: HTTP ${last.status}`);
  const lastRun = (await last.json())?.data?.items?.[0];
  if (!recheckDue(lastRun?.startedAt ?? null)) return { started: false, why: "ran this week" };

  // the listings either of you stamped, or that are somewhere in the pipeline
  const [stamps, tracked] = await Promise.all([
    db.from("stamps").select("listing_id"),
    db.from("tracking").select("listing_id").in("stage", RECHECK_STAGES),
  ]);
  if (stamps.error) throw new Error(`stamps: ${stamps.error.message}`);
  if (tracked.error) throw new Error(`tracking: ${tracked.error.message}`);
  const ids = [...new Set([...stamps.data, ...tracked.data].map((r) => r.listing_id as string))];
  if (!ids.length) return { started: false, why: "nothing stamped or in the pipeline" };

  const since = new Date(Date.now() - RECHECK_WITHIN_DAYS * 86400e3).toISOString();
  const { data: rows, error } = await db.from("listings").select("url").in("id", ids).gte("last_seen_at", since);
  if (error) throw new Error(`listings: ${error.message}`);
  const urls = [...new Set(rows.map((r) => r.url as string).filter((u) => u?.startsWith("https://streeteasy.com/")))];
  if (!urls.length) return { started: false, why: "no links to check" };

  // the results come back to ingest, like any other run
  const webhooks = btoa(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    requestUrl: opts.ingestUrl,
    headersTemplate: JSON.stringify({ "x-webhook-secret": opts.secret }),
  }]));
  const res = await fetch(`${API}/actor-tasks/${task}/runs?webhooks=${encodeURIComponent(webhooks)}`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ startUrls: urls.map((url) => ({ url })) }),
  });
  if (!res.ok) throw new Error(`start recheck: HTTP ${res.status} ${await res.text()}`);
  return { started: true, listings: urls.length };
}
