#!/usr/bin/env bash
# SessionStart hook — local sessions only. Surfaces the per-session worktree
# protocol (CLAUDE.md → Working discipline → Worktrees) before work starts: the
# existing worktrees and the branch this checkout is on.
#
# A nudge only: it creates, removes and fast-forwards nothing, and makes no
# network calls. Cloud sessions are already isolated clones, so it stays silent.

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

worktrees="$(git worktree list 2>/dev/null)"
branch="$(git branch --show-current 2>/dev/null)"
[ -z "$branch" ] && branch="(detached HEAD)"

context="Local session: run the per-session worktree protocol before starting work (CLAUDE.md → Working discipline → Worktrees). The \`main\` checkout stays clean on \`main\`; work happens in a dedicated worktree.

Current worktrees:
${worktrees}

You are on branch: ${branch}

Before writing code:
1. Assess the worktrees above: does an existing one already cover this work?
2. Decide reuse vs new: a continuation reuses that branch's worktree; new work gets \`git worktree add ../stoop-worktrees/<branch> -b <branch> origin/main\` (named after the work, no agent prefix). Never start new work in the main worktree.
3. Keep main current: \`git fetch origin\`, then fast-forward the main worktree if it's clean, so new branches start from current main.
4. Ask the user about worktree cleanliness (stale worktrees worth \`git worktree remove\`) and how up to date main is. Don't assume.

Trivial edits, questions, and a continuation already in the right worktree skip the ceremony."

jq -n --arg ctx "$context" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
exit 0
