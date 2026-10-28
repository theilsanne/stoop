<!--
  Stoop PR template. Keep the headings and fill them in from the diff.
-->

## Summary

<!-- What does this PR do and why? -->

## Database / Supabase

<!--
  Pushing to main redeploys the app (GitHub Pages). Nothing else is automatic:
  migrations are run by hand in the SQL editor, and Edge Functions are deployed
  by hand. Tick what applies and list it.
-->

- [ ] **No database or function change.**
- [ ] **Migration(s)**, run by hand in order in the SQL editor:
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
