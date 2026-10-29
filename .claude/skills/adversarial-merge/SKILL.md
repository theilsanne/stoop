---
name: adversarial-merge
description: Take a PR to merge-ready through an adversarial review loop, then stop for the user's go-ahead. Each round, a fresh opus reviewer attacks the diff; its findings become fix commits; the next fresh reviewer verifies those fixes and hunts what's left, until a round comes back clean. Then rebase onto main, re-run the checks, and hand the user a review of what the loop found and changed. The merge happens only on the user's explicit go, given after that hand-off. Use only when the user invokes /adversarial-merge or asks for the review loop by name; a request to merge is not one, and merges straight through the On the user's go steps.
---

# Adversarial merge

An author reviewing their own diff sees what they meant to write. A reviewer who didn't write it, and is asked to refute it, sees what the diff does: the crash path nobody tested, the input a stranger controls, the caller the change never mentioned. Each round's fixes are new code, so the next reviewer checks those too. The loop runs until a fresh reviewer finds nothing that should block. Then a person decides whether it merges.

## Invariants

0. **The loop runs when the user invokes it.** It costs time and tokens they chose to spend. A go to merge a PR they've already seen merges it through *On the user's go*, with no loop first.
1. **The loop ends at the user, and the user decides the merge** (CLAUDE.md, working discipline 8).
   - A "merge it" that started the loop is spent on the loop.
   - A "merge" given in answer to the hand-off is the go. It merges and does not start another loop.
   - The merge is one call, made after the go. Auto-merge stays off.
2. **Every round gets a fresh reviewer.** Each round spawns a new **opus** agent. Continuing a reviewer with `SendMessage` anchors it on its own earlier verdict; a new one reads the code cold. The reviewer is read-only: it edits nothing and never pushes.
3. **Reviewers refute; the main loop decides.** The reviewer backs each claim with the code it traced. The main loop gives every finding one disposition:
   - **fixed:** a commit;
   - **declined:** with the reason and the evidence, because the claim is wrong or out of scope;
   - **accepted as-is:** a NIT left alone, with the reason.

   An UNVERIFIED claim is settled by the main loop, or by a fresh verifier asked to refute it, before the round can count as clean.
4. **Fixes are the next round's subject.** Each round after the first gets every earlier finding with its disposition. It verifies the fixes first, and raises a declined or accepted finding again only with new evidence.
5. **Every fix is verified.** Every round runs `npm test` and `cd app && npm run build`. A UI fix is also checked in `npm run dev` with `?demo`, or the hand-off says it wasn't. Each fix is its own commit, pushed, and its message names the finding it answers.
6. **Clean is a triaged state, and the loop is capped.**
   - A round is clean when, after triage, no BLOCKER or SHOULD-FIX is open and no UNVERIFIED item is unsettled.
   - The loop runs at most **five rounds**. If it isn't clean by then, it stops and goes to the user with what remains.
   - A rebase conflict or a change requested at the hand-off starts a **delta loop**, scoped to that delta. It is clean after one clean round, with at most three rounds. If it isn't clean by its cap, it goes to the user the same way.
7. **Scope stays the PR's.** Problems the PR introduces are fixed in it. Problems that predate the PR, or sit outside its diff, go into the PR's Notes and the hand-off as proposed follow-ups. The user decides whether they widen this PR.

## The loop

### 1. Before round 1
- The PR is pushed to the session's branch, and the user has invoked the loop.
- Note what the change touches. These shape the reviewer's attack list:
  - migrations or Edge Functions (merging doesn't apply them, so the order and the re-run safety matter);
  - untrusted text reaching the DOM (listing text, notes, names, scraped fields);
  - auth, RLS or secrets;
  - scoring rules;
  - the service worker or web push;
  - the Pages build at `/stoop/`.

### 2. A review round
Run `git fetch origin` first, so the diff is against the current `main`. Spawn the reviewer in the foreground with a self-contained prompt (subagents skill → *Writing the prompt*), carrying:

- **Where:** the worktree's absolute path, the branch, the PR number, the diff command `git -C <worktree> diff origin/main...HEAD`, and the PR body (`mcp__github__pull_request_read`).
- **What the change does**, in a few lines.
- **The rules:** `CLAUDE.md`, plus the skills for the areas touched. Name the files: `.claude/skills/swe/SKILL.md`, `.claude/skills/backend/SKILL.md`.
- **The attack list,** tailored to the change. These are prompts to adapt, not boilerplate:
  - every state a screen runs in: loading, empty, signed out, `?demo`;
  - untrusted text that reaches `innerHTML` without `esc()`;
  - RLS: can one person write the other's ratings or criteria? Does a new table have RLS and grants?
  - Edge Functions: is the caller checked in code, before any service-role write? Is the webhook secret compared in constant time?
  - migrations: does one edit a migration that has run? Is it safe to run twice, and in order? Does a view keep `security_invoker`?
  - `Api` parity: is each new read or write in both `SupabaseApi` and `DemoApi`?
  - scoring: does a change to `scoring.ts` have its test?
  - what merging deploys: the Pages build, and which functions or migrations must be run by hand.
- **For rounds 2 and later:** every earlier finding with its disposition (the fix commit, or the reason it was declined or accepted), and the order to work in: verify the fixes, look for regressions they introduced, then sweep for anything still open.
- **The deliverable:** findings most severe first. Each has a severity (BLOCKER / SHOULD-FIX / NIT), `file:line`, a concrete failure scenario, and the evidence traced. Also: UNVERIFIED items with what would settle them, one line per clean area, a closing verdict (READY or NOT READY), and a word cap of about 600.

### 3. Triage and fix
- Give every finding a disposition (invariant 3), and settle the UNVERIFIED ones.
- Fix the BLOCKERs and SHOULD-FIXes you accept, and any NITs that are cheap. Verify each fix (invariant 5), then commit and push it, naming the finding.
- Keep a running list of findings, dispositions and commits. It feeds the next round's brief and the hand-off.

Then go back to step 2 for the next round, until a round is clean or the cap is reached.

### 4. Make it merge-ready
- **Check the migration order.** Compare the branch's migration timestamps with the newest ones on `origin/main`. An unmerged, unrun migration that main has overtaken gets renamed to a fresh timestamp, since nothing restamps it automatically. A migration that has already run is never edited.
- **Rebase** onto `origin/main`. Resolve conflicts by keeping what `main` changed and re-applying the branch's intent on top. Use `git push --force-with-lease` only for this session's own branch, and only after the rebase rewrote its commits. Never force-push a branch someone else pushed to.
- **Re-run the checks:** `npm test` and `cd app && npm run build`.
- **Run a delta loop** if the rebase touched reviewed code (invariant 6).
- **Note the checks in the hand-off.** Stoop has no CI, so the local checks are the whole gate. Say so plainly.

### 5. The hand-off: stop here
Give the user the review under a large header that says the PR is **ready to merge and waiting for your go**:

- each round in a line or two: what it found and what changed;
- what was verified, and how (`npm test`, the build, and any `?demo` check, or what stayed unchecked);
- findings declined or accepted, and why;
- pre-existing problems found outside the diff, proposed as follow-ups;
- what merging does: the Pages deploy on push to `main`, plus the migrations and functions to run by hand, from the PR's Database section;
- anything the user should check by hand before deciding.

Ask the decision with `AskUserQuestion`: merge now, or hold for changes. Then wait.

If the user asks for changes, the changes are a new diff:
- fix them;
- run a delta loop on them (invariant 6);
- redo *Re-run the checks* in step 4;
- return to this hand-off.

### 6. On the user's go
1. **Re-check the PR.** Fetch, and confirm the PR's head is still the one handed off and `origin/main` hasn't moved under it. If it has, check for conflicts and migration order, then redo step 4 and hand off the delta. A go covers the PR the user saw.
2. **Match the repo's merge style.** Run `git log --merges --oneline -3` on `main`. If the repo uses merge commits, merge with `mcp__github__merge_pull_request` and `merge_method: "merge"`; if it squashes, use `"squash"`. Use the GitHub MCP tool, since `gh` isn't available here.
3. **Confirm** the Pages run succeeded when the PR touched `app/`. Use `mcp__github__actions_list` to find the `pages.yml` run for the merge commit.
4. **Clean up.** Remove the worktree (`git worktree remove`), then delete the branch locally and on the remote.
5. **Report** with a large header: what merged, what deployed, what the user still has to run by hand.

## Cost

An opus review of a Stoop PR is small: the diff is modest and there is no device pass to wait on. Five rounds is the ceiling, not the plan. Keep each brief to the diff and the files it touches, and scope later rounds to the fixes and what's still open, so each round costs less than the one before.
