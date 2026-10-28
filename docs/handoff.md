# Handoff: profile photos, stamps, branch previews

Branch: `th-/great-fermi-9u0pes` (head `c64002d` when this was written). Not merged. No PR.

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

**Verified**
- The preview loads at `https://theilsanne.github.io/stoop/previews/th-great-fermi-9u0pes/`.
- It shows the red error "Could not find the table 'rentals.stamps' in the schema cache". That's expected until the migrations are applied on the Stoop project, and the app loads nothing until then.

**Not yet done**
- The two migrations are not applied to the Stoop Supabase project.
- The preview sign-in redirect is not configured. Add `https://theilsanne.github.io/stoop/previews/**` under Authentication → URL Configuration → Redirect URLs.
- Photo upload and stamps haven't been tested against the real project.

## Blocked: applying the migrations from the cloud session

- Stoop's Supabase project ref: `jjrjswxakuneoxipdswd` (region `ca-central-1`). The Supabase connector in this session can't see it. Only the "Shared Screen" org with `tv-app-prod` and `tv-app-dev` is visible.
- The environment has `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` set. The Supabase CLI (`npx supabase@2`) can link the project.
- `supabase migration list --linked` fails. The database hosts don't resolve from the sandbox:
  - `aws-0-ca-central-1.pooler.supabase.com`
  - `db.jjrjswxakuneoxipdswd.supabase.co`
- These were added to the environment's allowed domains, but the change didn't reach the session it was made in. A new session may pick it up.

## Next steps

1. In the new session, check the hosts resolve:
   ```bash
   getent hosts aws-0-ca-central-1.pooler.supabase.com
   getent hosts db.jjrjswxakuneoxipdswd.supabase.co
   ```
2. Link and check the history:
   ```bash
   cd /home/user/stoop
   npx --yes supabase@2 link --project-ref jjrjswxakuneoxipdswd
   npx --yes supabase@2 migration list --linked
   ```
3. Apply the two new migrations only if the history shows the earlier ones (`20261006000000` through `20261028010000`) as applied. Otherwise, apply them in the SQL editor in order, as CLAUDE.md describes.
   ```bash
   npx --yes supabase@2 db push --linked
   ```
4. Confirm the `avatars` bucket and `rentals.stamps` table exist, and that the RLS policies are present.
5. Reload the preview, and confirm the red error is gone. Then ask the user to test stamping, the sheet pill, and adding a photo.
6. Add the preview redirect URL in Supabase (step above).

## Things to know

- `main` has moved since this branch started (commit `f69dac6`, "Tidy Settings and the listing sheet…"). Rebase or merge before any merge to `main`, and expect conflicts in `app/src/views/other.ts` and `app/src/styles.css`.
- A stale preview folder, `th--great-fermi-9u0pes`, is still on the `pages-previews` branch. It came from the first slug bug and is unused. It can be deleted.
- Previews are built against the real Supabase project, so an unmigrated database shows errors in them.
- `profiles` is `household_all`, so either person can edit the other's profile row. This is the existing behavior for names too. Either person could repoint the other's photo.
- Merging to `main` is the user's call (CLAUDE.md, rule 7).
- Don't commit secrets. The access token and database password live only in the environment settings.
