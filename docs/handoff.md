# Handoff: profile photos, stamps, branch previews

Branch: `th-/great-fermi-9u0pes`. Not merged. No PR. Last updated 2026-10-28 by the session that tried to apply the migrations (see "Session log").

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

Stoop's Supabase project ref is `jjrjswxakuneoxipdswd` (region `ca-central-1`). Two routes were tried. Both are blocked as of 2026-10-28.

**Route 1: the Supabase connector.** Blocked by access, not by the network.
- `list_projects` shows only `tv-app-prod` and `tv-app-dev`, in the "Shared Screen" org (`wjzneobvqysecsrhrsea`). Stoop's project isn't in the list.
- `get_project`, `list_migrations` and `execute_sql` all return "You do not have permission to perform this action" for `jjrjswxakuneoxipdswd`.
- The user is an admin of the Stoop project, but the connector is signed in to a different org. Fix: reconnect the Supabase connector with the account or org that owns Stoop, so `list_projects` shows it.
- Nothing was applied to `tv-app-prod` or `tv-app-dev`. They belong to another project and must not be touched for Stoop.

**Route 2: the Supabase CLI.** Blocked by the sandbox network.
- The environment has `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` set. `npx supabase@2` can link the project once the hosts resolve.
- In the session of 2026-10-28, these resolved: `aws-0-ca-central-1.pooler.supabase.com` and `api.supabase.com`.
- `db.jjrjswxakuneoxipdswd.supabase.co` did not resolve. The user then added that exact host under Network access (Allowed domains), and asked for a new session so the change applies. Not yet verified.

## Session log

**2026-10-28**
- The session started on `th-/elegant-ptolemy-3tbn2y`. Switched to `th-/great-fermi-9u0pes` (`git checkout -B th-/great-fermi-9u0pes origin/th-/great-fermi-9u0pes`). The working tree was clean.
- DNS check: the pooler and `api.supabase.com` resolve. The `db.` host did not.
- Supabase connector: blocked, as above. Admin rights on the project didn't change this.
- Nothing applied, nothing merged, no preview check (it would show the expected red error).
- The user added `db.jjrjswxakuneoxipdswd.supabase.co` to Network access and started a new session.

## Next steps

Run these in the new session, in order. Stop and report at the first failure.

1. Check the hosts resolve:
   ```bash
   getent hosts aws-0-ca-central-1.pooler.supabase.com
   getent hosts db.jjrjswxakuneoxipdswd.supabase.co
   ```
2. Try the Supabase connector first: `list_projects`. If `jjrjswxakuneoxipdswd` is listed, check `list_migrations` for that project. If it isn't listed, use the CLI route.
3. Link and check the history (CLI):
   ```bash
   cd /home/user/stoop
   npx --yes supabase@2 link --project-ref jjrjswxakuneoxipdswd
   npx --yes supabase@2 migration list --linked
   ```
4. Apply the two new migrations only if the history shows the earlier ones (`20261006000000` through `20261028010000`) as applied. Otherwise stop: the history doesn't match, and a person should decide how to reconcile it. Don't apply out of order.
   ```bash
   npx --yes supabase@2 db push --linked
   ```
5. Confirm the `avatars` bucket and `rentals.stamps` table exist, and that the RLS policies are present.
6. Reload the preview, and confirm the red error is gone. Then ask the user to test stamping, the sheet pill, and adding a photo.
7. Add the preview redirect URL in Supabase (see "Not yet done").

## Things to know

- `main` has moved since this branch started (commit `f69dac6`, "Tidy Settings and the listing sheet…"). Rebase or merge before any merge to `main`, and expect conflicts in `app/src/views/other.ts` and `app/src/styles.css`.
- A stale preview folder, `th--great-fermi-9u0pes`, is still on the `pages-previews` branch. It came from the first slug bug and is unused. It can be deleted.
- Previews are built against the real Supabase project, so an unmigrated database shows errors in them.
- `profiles` is `household_all`, so either person can edit the other's profile row. This is the existing behavior for names too. Either person could repoint the other's photo.
- Merging to `main` is the user's call (CLAUDE.md, rule 7).
- Don't commit secrets. The access token and database password live only in the environment settings.
