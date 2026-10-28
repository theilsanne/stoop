// alerts: what the app needs to turn phone alerts on, and a test button.
//   POST {"action":"key"}   → {"publicKey": "..."} to subscribe a phone with
//   POST {"action":"test"}  → sends a test alert to your own phones
//
// Deploy with:  supabase functions deploy alerts --no-verify-jwt

import { serviceClient } from "../_shared/pipeline.ts";
import { APP_URL, sendTo, vapidPublicKey } from "../_shared/push.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = serviceClient();
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = token ? await db.auth.getUser(token) : { data: { user: null }, error: null };
  if (error || !data.user) return json({ error: "Sign in first" }, 401);

  const { action } = await req.json().catch(() => ({ action: "" }));
  if (action === "key") {
    const publicKey = vapidPublicKey();
    return publicKey ? json({ publicKey }) : json({ error: "Alerts aren't set up yet: the VAPID keys are missing from Supabase secrets." }, 500);
  }
  if (action === "test") {
    try {
      const r = await sendTo(db, [data.user.id], {
        title: "Stoop alerts are on",
        body: "This is what a new listing will look like. Tap to open Stoop.",
        url: APP_URL, tag: "test",
      });
      console.log("test alert", JSON.stringify(r));
      return json(r);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }
  return json({ error: "Unknown action" }, 400);
});
