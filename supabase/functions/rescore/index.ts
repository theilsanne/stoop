// rescore: the app calls this after either of you saves criteria.
// Re-scores every active listing against both people's current criteria.
//
// Deploy with:  supabase functions deploy rescore
// Only a signed-in person (one of you two) can run it.

import { createClient } from "npm:@supabase/supabase-js@2";
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

  // The anon key is also a valid JWT, so check there's a real signed-in user behind the token.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const auth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return json({ error: "Sign in first" }, 401);

  const results = await scoreAndStore(serviceClient(), null);
  const all = Object.values(results);
  return json({
    rescored: all.length,
    passing: all.filter((r) => r.passes).length,
    near_misses: all.filter((r) => r.near_miss).length,
  });
});
