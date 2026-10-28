---
name: subagents
description: How to delegate work to subagents in Stoop: model selection, what to delegate and what to keep, self-contained prompts, adversarial plan review, verification, and isolation. Read before spawning any subagent (Agent tool).
---

# Working with subagents

Subagents buy throughput (independent chunks in parallel) and fresh eyes (review that didn't write the code). They also waste quota when misused. A subagent has no conversation context, no user access, and no judgment about scope you didn't give it. This skill is the contract for using them well.

## Invariants

1. **Every subagent call names an explicit model, and never fable.** Pick the cheapest model the task allows, because the main loop holds the judgment:
   - `haiku` for read-only work: search, mapping, inventories, flow traces, however broad. The agent reads and reports; the main loop weighs the report. Trivial lookups too.
   - `sonnet` for mechanics and bounded judgment: mechanical transforms, boilerplate, a spec'd single-file fix, verification.
   - `opus` for deep reasoning: plan review, adversarial critique, hard debugging.

   An omitted model inherits the main loop's, built-in types such as `Explore` included, so a read-only sweep from an opus main loop runs at opus. [`agent-model-guard.sh`](../../hooks/agent-model-guard.sh) blocks an `Agent` call with no model, or with `fable`. Forks always take the parent's model, so they pass.
2. **Subagent prompts are self-contained.** The agent sees none of the conversation. Every prompt carries its absolute paths, the branch, the constraints, and the deliverable. If it needs a convention, name the skill file to read (for example `.claude/skills/backend/SKILL.md`). Skills load for the main session, not for subagents.
3. **Delegated output is committed and pushed the moment it lands, before review** (CLAUDE.md, working discipline 1). Review findings become follow-up commits. Unpushed work is invisible work.
4. **The main loop owns decisions and user communication.** Subagents inform. They never settle scope or product questions, and never speak to the user. Their final report isn't shown to the user, so relay what matters in your own summary.
5. **Parallel agents that write files get worktree isolation** (`isolation: "worktree"` on the Agent tool). Two agents writing one working tree corrupt each other. Read-only agents and single-writer flows don't need it.

## Efficiency: subagents draw from shared quota

- **Finite deliverable, finite scope.** Every prompt states what the agent must return and what it works within. "Keep improving until it's perfect" or "search everything" runs for an hour and returns nothing usable.
- **Every loop gets a cap**, decided before launch: a maximum number of rounds or retries. Never loop until something converges with no bound.
- **Stop agents that don't converge.** An agent running far past its scope, or retrying the same failing step, gets stopped and the approach reassessed in the main loop. Don't re-prompt it in a circle with the same instructions.
- **Continue, don't respawn.** A follow-up for an agent that already holds the context is a `SendMessage` continuation. A cold respawn re-reads everything.
- **Right-size the fan-out.** One agent per genuinely independent chunk. More agents than independent chunks is parallelism at quota prices.

## What to delegate, and what to keep

| Task shape | Do this |
|---|---|
| Broad read-only mapping ("every call site of X", "which tables touch Y") | `Explore` agent, haiku, in the background |
| Independent implementation chunks with no shared files | general-purpose agents in parallel, with worktree isolation |
| Attacking a plan before executing it | opus agent, prompted to refute it |
| Verifying a finding or a fix | a fresh agent that did **not** produce it |
| Single fact in a file you already have open | yourself. A subagent is pure overhead |
| Anything needing a user decision | the main loop |

Run subagents in the background by default. Launch independent ones in one batch. Don't report a pending agent's result before its completion notification arrives; keep working on something else.

## Writing the prompt

State, explicitly:

- **The deliverable and its shape.** "Return a list of `file:line` with one line each" or "return unified diffs only". Subagents return data to the main loop, not prose for the user.
- **The boundaries.** Which directories are in scope, what must not be touched, and whether committing is allowed. The default is no: the main loop commits.
- **The inputs.** Absolute paths, the branch to read, and the skill files that govern the area.
- **For search agents, the breadth.** "Medium" and "very thorough" change how far the search goes. Say which.

A vague prompt doesn't fail loudly. It returns something plausible in the wrong shape, and the rework costs more than the prompt would have.

## Adversarial plan review

Before executing a non-trivial plan (a multi-file change, a schema or migration change, or a sequence of steps that depend on each other), spawn an **opus** subagent whose job is to find what's wrong with it. Give it the plan, the relevant file paths, and the governing skill files. Don't give it your reasoning narrative. It looks for mistakes, missed cases, regressions the plan would cause, and materially better alternatives. Fold its findings into the plan, then act. Skipping this on plans that look simple is how simple plans break adjacent features.

## Verification patterns

- **The producer never verifies its own work.** Use a fresh agent, or the main loop.
- **Ask verifiers to refute, not confirm.** "Try to refute this claim, and default to refuted when unsure." A verifier asked to confirm will confirm.
- **Verify through the path the user will exercise.** For Stoop that is the real Supabase path or `?demo` in `npm run dev`, not a stub that reimplements the mechanism.
- **Verify each finding separately.** Don't batch unrelated claims into one verdict.

## Anti-patterns

- Delegating something whose answer is already in your context. That's round-trip cost for no new information.
- One large agent doing serial work that splits into independent agents. The reverse is also wrong: fanning out agents that each need the others' output.
- Re-running a search yourself while an agent does the same search. Pick one.
- Treating a subagent's confident report as verified fact. A report is a claim. Check the load-bearing ones.
- Two agents editing the same files at once.
