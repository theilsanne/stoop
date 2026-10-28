// commute: work out transit times from active listings to your saved places
// (via Transitous), a batch at a time, then re-score. The app calls it after you
// add a place, and from Settings.
//
// Deploy with:  supabase functions deploy commute --no-verify-jwt

import { computeCommutes, scoreAndStore, serviceClient } from "../_shared/pipeline.ts";

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

  try {
    const result = await computeCommutes(db, null, 40);
    if (result.computed) await scoreAndStore(db, null);
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
