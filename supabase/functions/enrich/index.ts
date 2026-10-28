// enrich: fill in building records (HPD violations, 311 complaints) for active
// listings that don't have them yet, then re-score. The app's Settings page calls
// it; it works in batches and reports how many are left.
//
// Deploy with:  supabase functions deploy enrich --no-verify-jwt
// Optional secret: NYC_OPENDATA_TOKEN (a free NYC Open Data app token; raises rate limits)

import { enrichBuildings, scoreAndStore, serviceClient } from "../_shared/pipeline.ts";

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
    const { retry } = await req.json().catch(() => ({ retry: false }));
    const result = await enrichBuildings(db, null, 60, !!retry);
    if (result.geocoded || result.buildings_checked) await scoreAndStore(db, null);
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
