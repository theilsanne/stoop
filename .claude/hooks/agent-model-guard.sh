#!/usr/bin/env bash
# PreToolUse hook (Agent) — every subagent call names its model
# (.claude/skills/subagents/SKILL.md → Invariants #1).
#
# A subagent with no `model` runs on the main loop's, built-in types such as
# Explore included, so a read-only sweep launched from an opus or fable main
# loop runs at that tier instead of the cheapest one the task allows. The rule
# was written down and still skipped, so this hook holds it:
#
#   - no `model` (or an empty one) → blocked, with the tiers to pick from;
#   - `model: "fable"` → blocked: the reserved tier never runs delegated work.
#
# `fork` subagents are exempt: a fork always takes the parent's model and
# ignores the field. Anything that isn't an Agent call passes untouched, and
# every failure path (no jq, unreadable input) exits 0 silently.
#
#
# Hand-run tests: bash .claude/hooks/tests/agent-model-guard-test.sh

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
# `Task` is the tool's older name.
case "$tool_name" in Agent|Task) ;; *) exit 0 ;; esac

subagent_type="$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)"
[ "$subagent_type" = "fork" ] && exit 0

model="$(printf '%s' "$input" | jq -r '.tool_input.model // empty' 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

tiers='haiku for read-only work (search, mapping, inventories, traces); sonnet for mechanics and bounded judgment; opus for deep reasoning'

if [ -z "$model" ]; then
  jq -n --arg t "$tiers" '{decision:"block",reason:("Mechanical guard: this Agent call names no `model`, so it would run on the main loop'"'"'s model (built-in types like Explore included). Name the cheapest model the task allows — " + $t + " — and retry. Rule: .claude/skills/subagents/SKILL.md → Invariants #1.")}'
  exit 0
fi

if [ "$model" = "fable" ]; then
  jq -n --arg t "$tiers" '{decision:"block",reason:("Mechanical guard: fable is reserved and never runs delegated work. Pick from " + $t + ", and retry. Rule: .claude/skills/subagents/SKILL.md → Invariants #1.")}'
  exit 0
fi

exit 0
