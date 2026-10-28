# Streamlining Stoop's setup: what got in the way, and how to fix it

This records the setup work for profile photos, stamps and branch previews: each step that was slow or blocked, the cause, and what to change so the next time takes minutes. Items are ordered by how much they cost.

## What happened

1. Migrations were run by hand in the SQL editor, so nothing recorded which ones had run on the project. Getting from "I think these are applied" to "I know" took a long detour.
2. The Stoop project wasn't visible to the Supabase connector in the cloud session. Only a different organization was. The connector returned "permission denied" for the project ref.
3. The Supabase CLI needed credentials, and the cloud environment had none. Adding them meant a sequence of UI steps in the environment menu, followed by a new session before they loaded.
4. Once the credentials were set, the CLI couldn't reach the database. The environment's network policy blocked `api.supabase.com`, then the database hosts. The first network change didn't apply to the session that made it.
5. Branch previews failed on their first run with no error text. The job died before any step ran, and the job log download returned 404. The likely cause was the `github-pages` environment's branch rule. That is still an inference, not a confirmed reading.
6. The preview folder name was computed by hand, and the result was wrong. The link in the first announcement returned 404 until the slug was fixed.
7. A check-in was scheduled for the first failed run, and it reported on the wrong run. Several check-ins were chasing runs that had already been superseded.

## Root causes

- **No record of migration state.** The project's `supabase_migrations` history isn't kept in step with the repo, because migrations were pasted in by hand.
- **Credentials and network are configured per environment, outside the repo.** A new session is needed before either change takes effect, and nothing in the repo says what the environment needs.
- **The preview pipeline depends on GitHub settings the repo can't see.** The `github-pages` environment rules and the Pages source aren't in version control.
- **Some values were derived by hand** (slugs, run IDs, hosts) rather than read from one place.

## How to streamline

### 1. Make migrations automatic
- Run `supabase db push` from CI on merge to `main`, using `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` stored as GitHub Actions secrets. This removes the hand-run step and the drift it causes.
- Before doing this, run `supabase migration list --linked` once against the real project and make the history match the repo. If the earlier migrations were pasted in by hand, the first `db push` will try to recreate them. Record them as applied first, or bring the project under the CLI's history.
- Keep a preview-safe check: `supabase db push --dry-run` on pull requests, so a bad migration shows up before merge.

### 2. Put the environment's needs in the repo
- Add a `docs/environment.md` that lists every host the sandbox needs (`api.supabase.com`, `aws-0-<region>.pooler.supabase.com`, `db.<ref>.supabase.co`), the environment variable names, and the access level to choose. A new environment then starts from a list, not from memory.
- The region and project ref are known now (`ca-central-1`, `jjrjswxakuneoxipdswd`). The pooler hostname depends on the region, so note it there.

### 3. Pin the preview pipeline
- Write down the `github-pages` and `github-pages-previews` environment rules in `docs/` (which branches each may deploy from), and the Pages source setting ("GitHub Actions"). These are repo settings, so keep a record next to the workflow.
- Keep the slug rule in one place and test it with a one-line check in the workflow, rather than working it out by hand. The workflow now collapses repeated dashes, so `th-/great-fermi-9u0pes` becomes `th-great-fermi-9u0pes`.
- Print the preview URL in the workflow's summary and on the PR (the workflow does both now). Don't announce a link that hasn't been built.

### 4. Make status checks read the right run
- Have each check-in name the commit SHA it's checking, not just the run ID, and look that run up by SHA before reporting. Cancel check-ins for superseded runs when a newer push happens.

### 5. Cut the rough edges in the app's error handling
- A missing table in `load()` stops the whole app from loading. Consider loading optional data (stamps) without failing the rest, and showing a single banner that names what's missing. That makes an unmigrated preview readable rather than empty.

### 6. Tighten credentials
- Use a token scoped to the project if Supabase offers it, and rotate it on a schedule. Keep the token and database password only in GitHub secrets and the environment settings, never in a file.
- Revoke the personal access token created for setup once CI runs the migrations.

## Open questions

- Does `supabase config push` apply the redirect URL allowlist without touching other auth settings? Check in the CLI's docs before relying on it.
- Is the first preview refusal really the `github-pages` branch rule? The run log wasn't available to confirm it. Check the environment's deployment branch settings in GitHub.
