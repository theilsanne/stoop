// rescore: the app calls this after either of you saves criteria.
// Re-scores every active listing against both people's current criteria.
//
// Deploy with:  supabase functions deploy rescore --no-verify-jwt
// The gateway check is off because it doesn't understand Supabase's newer
// publishable keys; this function checks the signed-in user itself instead.

import { scoreAndStore, serviceClient } from "../_shared/pipeline.ts";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = serviceClient();

  // Only a real signed-in user (one of you two) may run this. A bare API key is not enough.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = token ? await db.auth.getUser(token) : { data: { user: null }, error: null };
  if (error || !data.user) return json({ error: "Sign in first" }, 401);

  try {
    const results = await scoreAndStore(db, null);
    const all = Object.values(results);
    return json({
      rescored: all.length,
      passing: all.filter((r) => r.passes).length,
      near_misses: all.filter((r) => r.near_miss).length,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
