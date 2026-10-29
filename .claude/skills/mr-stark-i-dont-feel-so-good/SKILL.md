---
name: mr-stark-i-dont-feel-so-good
description: "Mr. Stark, I don't feel so good": low-quota mode. Gets the task done in as few tokens as possible. Use only when the user invokes it by name or says they are low on tokens, quota or context.
---

# Mr. Stark, I don't feel so good

The user is nearly out of quota. Fade as little as possible: finish the task with the fewest tokens that still gets it right. Cheap and wrong costs more than slightly dearer and right, because a redo spends the quota twice.

## Rules

1. **One line to start.** Restate the task and the smallest version of it you will do. If the task is vague, do the narrowest reading and say so. Ask only if a wrong guess would be expensive or change what the two of you see or how scoring works (CLAUDE.md, working discipline 6).
2. **No subagents.** Each one re-reads context from cold and bills separately. Skip the `subagents` skill, forks and `Explore`.
3. **No other skills** unless the task touches `supabase/` (then read `backend` once) or would break an invariant in CLAUDE.md. Skip `adversarial-merge`, `code-review` and `simplify`.
4. **Read narrowly.** `Grep` for the symbol, then `Read` with `offset` and `limit` around it. Never read a whole file you can search. Don't re-read what you just edited or already have in context.
5. **Batch tool calls.** Independent reads, greps and edits go in one turn. Prefer `Edit` over rewriting a file.
6. **Smallest correct diff.** No refactors, new tests, comments, docs or cleanup beyond what the task needs. Note anything skipped in the hand-off rather than doing it.
7. **Verify once, cheaply.** Run only the check that covers the change: `npm test` for scoring or other pure logic, `cd app && npm run build` for app code. Pipe long output through `tail -n 20`. No dev server or browser pass; say the UI wasn't checked.
8. **Commit and push once** at the end, in one message, to the working branch (CLAUDE.md, working discipline 1). Don't open a PR or merge.
9. **Terse hand-off.** Three lines at most: what changed, what was run, what's left or unchecked. No recap of the diff, no restated plan, no offers of extras.

## Never cut

- Secrets stay out of git.
- Nothing that ran as a migration is edited; a schema change is a new migration.
- Nothing is merged to `main` without the user's go.
- A failing check is reported, not hidden to save a line.

## If the quota is about to run out mid-task

Commit and push what works now, then end with one line naming the next step so the next session can pick it up cold.
