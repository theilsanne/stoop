# Handoff: profile photos, stamps, branch previews

Branch: `th-/great-fermi-9u0pes`. Not merged. No PR. Last updated 2026-10-28 by the session that applied the migrations (see "Session log").

## Where things stand

**Built and pushed**
- Profile photos: each person adds or removes a photo in Settings. Photos are cropped to a square on the phone and stored in a private `avatars` bucket. Initials show until a photo is added.
- Stamps: "I really like this one" on a listing's photo (feed card) or in the listing sheet. The partner's stamp shows beside yours. Stamps don't affect scoring.
- Both are wired through `Api` (`SupabaseApi` and `DemoApi`). `?demo` works.
- Migrations, written and tested on a local Postgres 16 with a stub of the Supabase auth and storage schemas:
  - `supabase/migrations/20261028020000_avatars.sql`
  - `supabase/migrations/20261028030000_stamps.sql`
- Branch previews: `.github/workflows/pages.yml`.
  - A push to any branch that changes the app deploys to `https://theilsanne.github.io/stoop/previews/<branch>/`. Repeated dashes collapse, so this branch is `th-great-fermi-9u0pes`.
  - Previews deploy through the `github-pages-previews` environment. `main` still uses `github-pages`.
  - Each preview comments its link on the branch's open PR, updating one comment.
  - Deleting a branch removes its preview.
  - The site lives on the `pages-previews` branch, which only the workflow writes.
- README and CLAUDE.md are updated to match.

**Applied to the Stoop Supabase project (2026-10-28)**
- `20261028020000_avatars.sql` and `20261028030000_stamps.sql` ran in order, through the Supabase Management API.
- Verified by read-only queries: the `avatars` bucket is private, limited to 2 MB and `image/jpeg`. `rentals.stamps` exists with RLS on. The `avatars_*` policies on `storage.objects` and the `stamps_*` policies on `rentals.stamps` are present. `rentals.profiles.avatar_path` exists.
- The project has no `supabase_migrations.schema_migrations` ledger. The earlier migrations are present by object (for example `feed`, `buildings`, `commutes`), so they look applied by hand. Don't run `supabase db push` on this project: with no ledger it would try to re-run `init`.

**Verified**
- The preview loaded before the migrations, and showed the red error "Could not find the table 'rentals.stamps' in the schema cache".
- Not re-checked after the migrations. The sandbox proxy returns 403 for `theilsanne.github.io`, so it can't be checked from the cloud session.

**Not yet done**
- The preview sign-in redirect is not configured. Add `https://theilsanne.github.io/stoop/previews/**` under Authentication → URL Configuration → Redirect URLs.
- Photo upload and stamps haven't been tested against the real project.

## Session log

**2026-10-28**
- The session started on `th-/elegant-ptolemy-3tbn2y`. Switched to `th-/great-fermi-9u0pes`.
- The Supabase connector only sees the "Shared Screen" org, which holds `tv-app-prod` and `tv-app-dev`. Stoop's project (`jjrjswxakuneoxipdswd`) is in another org, so the connector can't reach it.
- The Management API reaches the project with `SUPABASE_ACCESS_TOKEN` (`api.supabase.com` resolves and returns the project). The earlier migration attempt blocked on `db.jjrjswxakuneoxipdswd.supabase.co` not resolving. The Management API route doesn't need that host.
- Applied the two new migrations in order through the Management API. Both returned no errors. Verified as above.
- Preview check: not possible from the cloud session (the sandbox proxy returns 403 for `theilsanne.github.io`).

## Next steps

1. Open `https://theilsanne.github.io/stoop/previews/th-great-fermi-9u0pes/` in a browser. Confirm the red "rentals.stamps" error is gone.
2. Add the preview redirect URL in Supabase (see "Not yet done").
3. Test photo upload, stamping, and the sheet pill with a real sign-in. Report anything that breaks.
4. Only then consider merging. Merging to `main` is the user's call.

## Things to know

- `main` has moved since this branch started (commit `f69dac6`, "Tidy Settings and the listing sheet…"). Rebase or merge before any merge to `main`, and expect conflicts in `app/src/views/other.ts` and `app/src/styles.css`.
- A stale preview folder, `th--great-fermi-9u0pes`, is still on the `pages-previews` branch. It came from the first slug bug and is unused. It can be deleted.
- Previews are built against the real Supabase project, so an unmigrated database shows errors in them.
- `profiles` is `household_all`, so either person can edit the other's profile row. This is the existing behavior for names too. Either person could repoint the other's photo.
- Merging to `main` is the user's call (CLAUDE.md, rule 7).
- Don't commit secrets. The access token and database password live only in the environment settings.
