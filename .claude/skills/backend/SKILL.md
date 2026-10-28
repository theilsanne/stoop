---
name: backend
description: Supabase conventions for Stoop: the rentals schema, RLS, migrations, Edge Functions, auth and secrets. Use before changing anything under supabase/, or any server-side logic.
---

# backend: Stoop's Supabase

Stoop runs on one Supabase project with one schema, `rentals`. There is no dev or prod split: the database you change is the one the two of you use. Treat every change as going live when it's applied.

## The schema

- All tables live in the `rentals` schema. The project exposes it through the Data API (`[api] schemas` in `supabase/config.toml`, and the README's setup step). A new table in another schema won't be reachable from the app.
- Every table has RLS enabled. The init migration loops over the household tables and adds the `household_all` policy, so both people can read and write them.
- Owner-only tables are `ratings` (write your own, read everyone's) and `criteria` (write your own, read everyone's). The `owner_id` or `user_id` column is the check. A new per-person table gets the same shape.
- Grants: `anon`, `authenticated` and `service_role` have usage on the schema, and the init migration grants table access. A new table needs the same grants, and RLS turned on, in its own migration.
- Views that read through RLS use `with (security_invoker = true)`, as `rentals.feed` does. Without it the view runs as its owner and skips the policies.

## Migrations

- One file per change, named `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. `supabase migration new <name>` stamps the timestamp.
- **Never edit a migration that has been run.** Add a new one. Editing history means the two of you and any fresh setup will disagree.
- Write them to be safe to run twice: `create schema if not exists`, `create table if not exists`, `add column if not exists`, `create or replace view`, and drop-then-create for policies.
- A view that gains columns puts them at the end, because `create or replace view` only allows that.
- Migrations apply on merge to `main` (`migrate.yml`, `supabase db push`). The PR's dry run shows what will apply, so check that output before merging. Say in the PR anything a migration needs beyond the SQL, such as a dashboard setting.
- Before running one on the real project, read it against the current schema, since there is no staging copy. A destructive statement (`drop`, `alter ... type`, a `delete`) needs a sentence in the PR explaining why it's safe.

## Edge Functions

- Functions live in `supabase/functions/<name>/index.ts`. Shared code goes in `_shared/`, and pure logic such as `scoring.ts` stays free of Supabase calls so the app and tests can import it.
- **`verify_jwt` is off for every function.** The gateway doesn't accept the newer publishable keys, so each function checks its own caller:
  - `ingest` is called by Apify, so it compares the `x-webhook-secret` header to `WEBHOOK_SECRET` in constant time (`safeEqual`). It returns 401 otherwise.
  - The others take the `Authorization` bearer token and call `auth.getUser(token)`. No user, no work.
- A new function does its own check, and its `index.ts` header says so. Deploy it with `supabase functions deploy <name> --no-verify-jwt`, and add it to `config.toml` with `verify_jwt = false`.
- Two Supabase clients: a user-scoped client for reads that should respect RLS, and `serviceClient()` (in `_shared/pipeline.ts`, using `SUPABASE_SERVICE_ROLE_KEY`) for the writes the pipeline owns. Use the service client only where the function has already checked the caller.
- CORS headers are a constant at the top of each function, and responses go out through its `json()` helper, which adds them. Keep that pattern in a new function so error responses carry them too.

## Secrets

- Set with `supabase secrets set NAME=value`. They are per project and never go in git.
- Current secrets: `APIFY_TOKEN`, `WEBHOOK_SECRET`, optional `OFF_MARKET_DAYS` (default 30) and `NYC_OPENDATA_TOKEN`.
- `openssl rand -hex 32` makes a good webhook secret. A new secret gets a line in the README's setup section.
- The app's `.env` holds only the publishable anon key and the project URL. Never the service role key, never a webhook secret.

## Auth

- The app signs in with magic links. Sign-ups are off in the Supabase dashboard, and both people are invited by hand.
- Each person's own data is keyed by their auth user id. Don't key anything on the email address.
- Push subscriptions are stored per phone (`push_subscriptions`). Removing one must be possible from the phone that owns it.

## Checks before hand-off

1. Read the migration once more against the schema it runs on.
2. Confirm the RLS policy with a query as each role, or state in the PR that it's unchecked.
3. For a function change, call it once with a real or fixture payload and say what came back.
4. List every migration and function to deploy, in order, in the PR's Database section.
