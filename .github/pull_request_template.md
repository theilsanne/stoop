<!--
  Stoop PR template. Keep the headings and fill them in from the diff.
-->

## Summary

<!-- What does this PR do and why? -->

## Database / Supabase

<!--
  Pushing to main redeploys the app (GitHub Pages) and applies new migrations
  (migrate.yml). Edge Functions are still deployed by hand. Tick what applies,
  and list anything a migration needs beyond its SQL.
-->

- [ ] **No database or function change.**
- [ ] **Migration(s)**, applied on merge to main (the dry run on this PR shows them):
  - `supabase/migrations/<timestamp>_<name>.sql`
- [ ] **Edge Function(s)**, redeployed by hand:
  - `supabase functions deploy <name> --no-verify-jwt`

## How to test

<!--
  Steps to check it. `npm test` covers the scoring, listing, building and
  subway logic; `cd app && npm run build` covers types and the bundle.
-->

## Notes

<!-- Screenshots, follow-ups, risks, anything a reviewer should know. -->
