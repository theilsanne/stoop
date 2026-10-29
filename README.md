# stoop

A private rental-search tool for two people hunting in Brooklyn. It pulls
StreetEasy listings through Apify, scores each one against both people's
preferences, and shows them in an installable web app at
**https://theilsanne.github.io/stoop/**.

## What's here

| Path | What it is |
| --- | --- |
| `supabase/migrations/20261006000000_init.sql` | The database: listings, each person's criteria, scores, ratings, pipeline stage, alerts. Everything lives in a `rentals` schema. |
| `supabase/functions/ingest` | Called by Apify after each scraper run. Saves new listings, marks ones unseen for 30 days (configurable) off-market, scores everything from the run. |
| `supabase/functions/rescore` | Called by the app after either person saves criteria. Re-scores every active listing. |
| `supabase/functions/enrich` | Called from the app's Settings. Looks up building records for listings that don't have them yet, in batches, then re-scores. |
| `supabase/functions/commute` | Called from the app's Settings and after adding a place. Works out subway commute times from listings to every saved place, then re-scores. |
| `supabase/functions/_shared/subway.ts` | Subway-only commute times: walk → wait → ride → change → walk, over a network built from the MTA timetable (`subway-graph.json`, rebuilt monthly by `scripts/build-subway.mjs` via the "Update subway network" workflow). |
| `supabase/functions/_shared/buildings.ts` | Address → BBL (NYC GeoSearch), open HPD violations, 311 complaints (NYC Open Data). No keys needed. |
| `supabase/functions/_shared/scoring.ts` | The scoring rules. Pure TypeScript, shared by both functions and the tests. |
| `supabase/functions/_shared/normalize.ts` | Turns one scraped StreetEasy item into a listing row. |
| `app/` | The web app (Vite + TypeScript, no framework). Deployed to GitHub Pages by `.github/workflows/pages.yml`: `main` is the live app, and other branches get previews. |
| `test/` | Tests for scoring and field mapping. Run `npm test` (Node 22.6+). |

## The app

| Screen | What it does |
| --- | --- |
| Feed | Listings scored for both of you, just you, or just your partner. Passing / near misses / filtered out. Rate yes/maybe/no from the card. Switch between **List** and **Map**: pins colored by score on OpenStreetMap tiles (no API key), with MTA subway lines from NY Open Data (`s692-irgq`). |
| Listing | Photos, rent and concessions, amenities, why it scores what it does for each of you, both verdicts and notes, stage, price history. |
| Criteria | Every feature you can care about in one list, each with one control for how much it matters: Skip, Nice, Important or Dealbreaker. Each row shows how many current listings fit and what a dealbreaker costs; rent has a histogram of the listings behind its slider; your partner's pick sits beside yours (green where you agree, amber where you differ, with a "We differ" view and a dot on neighborhoods you both picked), and you can pick up one of their own phrases with a tap. A bar at the top shows how many listings fit you before you save (saving re-scores everything), and nudges you when a dealbreaker is keeping out too many. Add your own phrase at the bottom. Change history for both of you. |
| Stamps | Your stamp sits on its ink pad, bottom left. Drag it onto a listing you really like (or focus one and press S) and it prints your seal there: your name, the day, and your photo in your own ink. Each of you has a colour. A stamp stays until you take it back from the listing's sheet. The feed's **Stamped** filter shows everything either of you has stamped. |
| Pipeline | Stamped → shortlisted → tour requested → toured → applied → won, plus passed. A listing lands in **Stamped** when either of you stamps it, and moves to **Shortlisted** on its own once you both have. Drag cards on from there. Empty late columns fold to slim rails so every step shows at a glance. A dot on the Pipeline tab and the Stamped filter means your partner has stamped something that is waiting for your stamp. |

Add `?demo` to the URL to try it on built-in sample listings without signing in.

**Run it locally:** `cd app && npm install && npm run dev`, with `app/.env.local` holding `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `app/.env.example`), or `VITE_DEMO=1` for sample data.

## How scoring works

- Each person keeps their own list of criteria: **dealbreakers** (pass/fail) and **wants** (Nice counts 2 and Important counts 5 in the score; older weights up to 10 still count as saved, and 4 or more shows as Important).
- A listing passes for a person when it passes all their active dealbreakers. Their score is the weighted share of their wants it meets, 0–100.
- Rent and other numbers get partial credit, fading to zero 10% past the line. Commutes fade out over 10 minutes past the line.
- A dealbreaker with a near-miss margin (say 5%) lets listings that miss by a little show up as near misses instead of vanishing.
- **Combined:** a listing passes only if it passes for both people, and its score is the average of the two.
- Missing data (no commute computed yet, no building record) is skipped, never counted against a listing.
- Net effective rent = asking rent × (lease months − free months) ÷ lease months.

## Setup

### 1. Supabase project

1. Create the project (Data API on, "automatically expose new tables" off).
2. **Authentication → URL Configuration**
   - Site URL: `https://theilsanne.github.io/stoop/`
   - Redirect URLs: the same, plus `http://localhost:5173/**` and `https://theilsanne.github.io/stoop/previews/**` (so sign-in works on branch previews)
3. **Authentication → Sign In / Providers:** Email on. Magic links come with it.
4. **Migrations:** `supabase link --project-ref <ref>`, then `supabase db push --linked`. Or paste `supabase/migrations/20261006000000_init.sql` into the SQL Editor and run it. After that, merges to `main` apply new migrations on their own (`.github/workflows/migrate.yml`).
5. **Project Settings → Data API → Exposed schemas:** add `rentals`.
6. **Authentication → Users:** invite both people. Each account gets one starter criterion ("Availability": available before April 1). Then turn off "Allow new users to sign up".

### 2. Apify

We use **memo23's "Streeteasy.com Scraper"** (`memo23/apify-streeteasy-cheerio`, pay per result).
In a test it kept the search URL's filters and newest-first sort; another scraper tried (abotapi) ignored both.

1. Build your search on streeteasy.com (rentals, your neighborhoods, a max price a bit above the higher budget, pets allowed), sort by **Newest**, and copy the URL. It looks like
   `https://streeteasy.com/for-rent/nyc/price:-5000%7Carea:...%7Cpets:allowed?sort_by=listed_desc`
2. Open the actor → **Use Actor**, put the URL in **Start URLs**, leave **Flatten dataset rows** on (the default), and leave Proxy alone.
3. **Save as task** twice:
   - **Frequent:** Max Listings `30`, scheduled every 2–3 hours for now (hourly in waking hours from February).
   - **Weekly:** Max Listings `0`/empty (everything), scheduled weekly. Hourly runs only see the newest listings; this one confirms which older listings are still up.
4. Copy your API token from **Settings → API & Integrations**.

**Off-market window.** Listings not seen for `OFF_MARKET_DAYS` days (default 30) are marked off-market. On Apify's free plan memo23 returns at most 50 listings per run, so older listings aren't re-seen and a long window keeps them in the feed. Once you're on a paid plan with a weekly full pull, shorten it: `supabase secrets set OFF_MARKET_DAYS=8`.

Field notes (handled in `normalize.ts`): memo23 sends `0` for unknown size and for "no concession", has no pet field (listings from a pets-allowed search are marked pets allowed), and has no no-fee flag (a listing is no-fee when its fee list has no broker fee).

### 3. Deploy the functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set APIFY_TOKEN=<token> WEBHOOK_SECRET=<a long random string>
supabase functions deploy ingest --no-verify-jwt
supabase functions deploy rescore --no-verify-jwt
supabase functions deploy enrich --no-verify-jwt
supabase functions deploy commute --no-verify-jwt
```

Optional: a free [NYC Open Data app token](https://data.cityofnewyork.us/profile/edit/developer_settings) raises the city's rate limits: `supabase secrets set NYC_OPENDATA_TOKEN=...`.

Both functions do their own checks: `ingest` requires the webhook secret, `rescore` requires a signed-in user. (Supabase's gateway check is turned off because it doesn't accept the newer publishable keys.)

`openssl rand -hex 32` makes a good webhook secret. Don't commit secrets; `.env` files are ignored.

### 4. Connect Apify to ingest

In **both** Apify tasks, add a webhook:
- Event: **Run succeeded**
- URL: `https://<your-project-ref>.supabase.co/functions/v1/ingest`
- Header: `x-webhook-secret: <the same secret>`

Leave the payload as Apify's default; `ingest` reads the run's dataset id from it.

### 5. First run

Start the task once by hand. When it finishes, the webhook response (in Apify's webhook log) looks like:

```json
{"items":42,"skipped_unusable":0,"saved":42,"new":42,"price_drops":0,"went_off_market":0,"would_alert":3}
```

Then open **Table Editor → rentals.listings** and spot-check a few rows against StreetEasy: price, net effective rent, neighborhood, beds, available date, no-fee. The full scraped item is kept in the `raw` column; if a field is empty, find its name there and add it to the matching list in `normalize.ts`.

### Database updates

Migrations in `supabase/migrations/` apply on merge to `main`, in filename order. After the first, `20261028000000_feed_buildings.sql` adds building records to the feed and `20261028010000_feed_commutes.sql` adds commute times (both safe to re-run). Then `20261028020000_avatars.sql` adds profile photos and `20261028030000_stamps.sql` adds listing stamps.

### Commute times

Each of you adds places in **Settings → Places** (name + NYC street address, located with NYC GeoSearch). Every listing gets a subway commute time to each place, worked out in our own functions from the MTA's subway timetable (weekday 7:30–9:30am pattern): walk to a nearby station (up to ~25 min), half the usual gap between trains as the wait, the typical ride times, MTA transfer times, and the walk at the end; walking instead when that's faster. The route is kept too (e.g. "Walk 4 → A → Walk 6"). We used Transitous before, but the MTA's published timetable ended Oct 31, 2026, so it stopped seeing subway service for dates after that. Criteria: **Commute to <place> within N min**, one per place.

### Building records

Each new listing's address is matched to a city building (BBL) with NYC Planning's GeoSearch, then its open HPD violations (by class) and 311 complaints from the past year are fetched and cached for 14 days. Lookups fail soft: a listing without a record is skipped by building criteria, never penalized. Addresses that can't be matched are marked (`bbl = ''`) and not retried. Rent-stabilization status isn't included: the city doesn't publish a reliable open list.

### 6. Publish the app

1. **GitHub → stoop → Settings → Pages:** set **Source** to **GitHub Actions**.
2. **GitHub → stoop → Settings → Secrets and variables → Actions → Variables tab → New repository variable**, twice:
   - `SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY` = the publishable (or legacy anon) key from **Supabase → Project Settings → API Keys**
   Both are meant to be public; row-level security and sign-in protect the data.
3. **Actions tab → Deploy to GitHub Pages → Run workflow** (later pushes deploy automatically).
4. Open `https://theilsanne.github.io/stoop/`, sign in with your email, and on Android choose **Add to Home screen** from Chrome's menu.

**Branch previews.** Pushing a branch that changes the app also publishes it at `https://theilsanne.github.io/stoop/previews/<branch>/`, with the link in that run's summary. A preview uses the real database, so run any new migrations first. Sign-in is per URL, so each preview asks for its own sign-in link. Deleting the branch removes its preview.

## Testing ingest by hand

You can also send items straight to ingest, skipping Apify:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/ingest \
  -H "x-webhook-secret: <secret>" -H "content-type: application/json" \
  -d '{"items":[{"id":"test-1","price":3400,"address":"1 Test St","areaName":"Crown Heights","bedrooms":2,"availableDate":"2027-01-01"}]}'
```

## Alerts

Phone notifications via web push, sent by ingest after each run: new listings that pass both of your dealbreakers and score at or above your own threshold (Settings → Alerts; more than three at once become one summary), and price drops on listings either of you said Yes or Maybe to or moved into the pipeline. Tapping one opens that listing. `rentals.alerts` records what was sent so nothing is sent twice.

Setup, once: generate VAPID keys with `npx web-push generate-vapid-keys`, then
`npx supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com`,
and deploy `alerts` and `ingest`. Each of you turns alerts on in Settings on your own phone (install Stoop to the home screen first).

## Not built yet

- Craigslist (on hold)
- Scheduled pulls / monitoring mode (planned for January)

## License

MIT, see [LICENSE](LICENSE). Icons from [Phosphor](https://phosphoricons.com) (MIT). Map data © OpenStreetMap contributors. Subway data from the MTA.
