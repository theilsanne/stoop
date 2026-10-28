# CLAUDE.md

Guidance for Claude Code in this repository. Stoop is small on purpose, so these rules are the ones it needs. The skills under `.claude/skills/` carry the detail for their area. The README has setup and the user-facing tour.

## Project: Stoop

A private rental-search tool for two people hunting in Brooklyn. It pulls StreetEasy listings through Apify, scores each one for both people against their own criteria, and shows them in an installable web app at https://theilsanne.github.io/stoop/.

Layout:
- `app/`: the web app. Vite and TypeScript, no framework. `main.ts` wires the screens, `views/` renders them, `api.ts` is the only door to the database, `demo.ts` is its sample-data twin.
- `supabase/functions/`: Edge Functions `ingest`, `rescore`, `enrich`, `commute`, `alerts`. Shared code is in `_shared/`.
- `supabase/migrations/`: the schema, in the `rentals` schema.
- `scripts/build-subway.mjs`: builds the subway network from the MTA timetable (`subway.yml` runs it monthly).
- `test/`: Node tests for the pure logic.

## Invariants

- **Two people, one household.** The tables are shared (`household_all` policy). Ratings and criteria are written by their owner only. Nothing here should assume more than two users.
- **Scoring is pure and lives in `supabase/functions/_shared/scoring.ts`.** The functions, the app and the tests all import it. No Deno or Supabase calls in it.
- **The app talks to the database only through `Api` in `app/src/api.ts`.** Any new read or write goes into both `SupabaseApi` and `DemoApi`, so `?demo` keeps working.
- **Migrations are applied by hand, in order.** There is no dev and prod split. A migration that has run is never edited; add a new one. Keep them safe to run twice.
- **Edge Functions are deployed with `--no-verify-jwt`** and check their caller in code. `ingest` checks `x-webhook-secret`; the others call `auth.getUser`. A new function does its own check.
- **Pushing to `main` deploys the app** (`pages.yml`). Nothing else ships on its own.
- **Secrets stay out of git.** Use `.env` files and `supabase secrets set`. The anon key in the app is public by design; the Apify token and the webhook secret are not.

## Working discipline

1. **Commit and push as you go.** Small commits with clear messages, pushed to the working branch as checkpoints.
2. **Branch names** are short, kebab-case, and named after the work. No agent or bot prefix. Develop on the branch the session names.
3. **Verify before hand-off:** `npm test`, `cd app && npm run build`, then the change's own steps. For a UI change, check it in `npm run dev` with `?demo`, or say plainly that it wasn't checked.
4. **Hand over with steps the user can run**, then wait for them to say it's done. Self-checks are due diligence, not sign-off.
5. **Ask** when a choice changes what the two of you see or how scoring works. Decide how things are built.
6. **Open a PR only when asked.**
7. **Merging to `main` is the user's call, every time, autonomous agents included.** A PR merges on the user's go, given after they've seen the hand-off. The adversarial-merge review loop runs only when the user invokes it.

## Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Node's test runner over `test/` (Node 22.6+, no install). |
| `cd app && npm install && npm run dev` | Vite on `localhost:5173`. Add `?demo` for sample listings without signing in. |
| `cd app && npm run build` | `tsc --noEmit`, then the Vite bundle for `/stoop/`. |
| `supabase migration new <name>` | Creates a timestamped migration file. |
| `supabase functions deploy <name> --no-verify-jwt` | Deploys one function: `ingest`, `rescore`, `enrich`, `commute` or `alerts`. |

## Where a fact goes

Things the two of you and any agent must follow go in this file or a skill. How to set Stoop up and what it does for users go in the README. Your own preferences stay in your own memory and are never committed.

## Skills

| Skill | Read before… |
|-------|--------------|
| [swe](.claude/skills/swe/SKILL.md) | changing the app or any TypeScript outside `supabase/` |
| [backend](.claude/skills/backend/SKILL.md) | changing migrations, RLS, Edge Functions, secrets or auth |
| [subagents](.claude/skills/subagents/SKILL.md) | spawning any subagent: model choice, self-contained prompts, verification |
| [adversarial-merge](.claude/skills/adversarial-merge/SKILL.md) | reviewing a PR before merge, when the user invokes the review loop by name |
