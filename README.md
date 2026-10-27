# stoop

A private rental-search tool for two people hunting in Brooklyn. It pulls new
StreetEasy listings on a schedule, scores each one against both people's
preferences, and (soon) pushes the good ones to both phones.

## What's here

| Path | What it is |
| --- | --- |
| `supabase/migrations/20261006000000_init.sql` | The database: listings, each person's criteria, scores, ratings, pipeline stage, alerts. Everything lives in a `rentals` schema. |
| `supabase/functions/ingest` | Called by Apify after each scraper run. Saves new listings, marks ones unseen for 8 days off-market, scores everything from the run. |
| `supabase/functions/rescore` | Called by the app after either person saves criteria. Re-scores every active listing. |
| `supabase/functions/_shared/scoring.ts` | The scoring rules. Pure TypeScript, shared by both functions and the tests. |
| `supabase/functions/_shared/normalize.ts` | Turns one scraped StreetEasy item into a listing row. |
| `test/` | Tests for scoring and field mapping. Run `npm test` (Node 22.6+). |

The app itself (a PWA on GitHub Pages) comes next.

## How scoring works

- Each person keeps their own list of criteria: **dealbreakers** (pass/fail) and **wants** (weighted 0–10).
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
   - Redirect URLs: the same, plus `http://localhost:5173/**`
3. **Authentication → Sign In / Providers:** Email on. Magic links come with it.
4. **SQL Editor:** paste `supabase/migrations/20261006000000_init.sql` and run it.
5. **Project Settings → Data API → Exposed schemas:** add `rentals`.
6. **Authentication → Users:** invite both people. Each account gets one starter criterion ("Available before April 1"). Then turn off "Allow new users to sign up".

### 2. Apify

We use **memo23's "Streeteasy.com Scraper"** (`memo23/apify-streeteasy-cheerio`, pay per result).
In a test it kept the search URL's filters and newest-first sort; another scraper tried (abotapi) ignored both.

1. Build your search on streeteasy.com (rentals, your neighborhoods, a max price a bit above the higher budget, pets allowed), sort by **Newest**, and copy the URL. It looks like
   `https://streeteasy.com/for-rent/nyc/price:-5000%7Carea:...%7Cpets:allowed?sort_by=listed_desc`
2. Open the actor → **Use Actor**, put the URL in **Start URLs**, leave **Flatten dataset rows** on (the default), and leave Proxy alone.
3. **Save as task** twice:
   - **Frequent:** Max Listings `30`, scheduled every 2–3 hours for now (hourly in waking hours from February).
   - **Weekly:** Max Listings `0`/empty (everything), scheduled weekly. Hourly runs only see the newest listings; this one confirms which older listings are still up. Anything not seen for 8 days is marked off-market.
4. Copy your API token from **Settings → API & Integrations**.

Field notes (handled in `normalize.ts`): memo23 sends `0` for unknown size and for "no concession", has no pet field (listings from a pets-allowed search are marked pets allowed), and has no no-fee flag (a listing is no-fee when its fee list has no broker fee).

### 3. Deploy the functions

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set APIFY_TOKEN=<token> WEBHOOK_SECRET=<a long random string>
supabase functions deploy ingest --no-verify-jwt
supabase functions deploy rescore
```

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

## Testing ingest by hand

You can also send items straight to ingest, skipping Apify:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/ingest \
  -H "x-webhook-secret: <secret>" -H "content-type: application/json" \
  -d '{"items":[{"id":"test-1","price":3400,"address":"1 Test St","areaName":"Crown Heights","bedrooms":2,"availableDate":"2027-01-01"}]}'
```

## Not built yet

- The PWA (feed, criteria editor, compare, pipeline) on GitHub Pages
- Web push alerts (ingest already works out who would get one)
- Commute times and NYC Open Data building records (scoring already uses them once filled)
