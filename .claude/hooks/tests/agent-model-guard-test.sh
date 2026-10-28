#!/usr/bin/env bash
#
# Hand-run tests for agent-model-guard.sh.
#
#   bash .claude/hooks/tests/agent-model-guard-test.sh
#
# The hook's contract is two properties, and the cases pin both:
#
#   - An Agent call with no model, an empty one, or fable is blocked.
#   - Everything else passes silently: a named model, a fork, other tools,
#     input the hook can't read.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../agent-model-guard.sh"
[ -f "$HOOK" ] || { echo "cannot find the hook at $HOOK"; exit 1; }

pass=0; fail=0
check() { # name, expectation (block|quiet), input
  out="$(printf '%s' "$3" | bash "$HOOK")"
  if [ "$2" = block ]; then
    printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null 2>&1 && ok=1 || ok=0
  else
    [ -z "$out" ] && ok=1 || ok=0
  fi
  if [ "$ok" = 1 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $1 (expected $2, got: ${out:-nothing})"; fi
}

check "no model" block '{"tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"x"}}'
check "no model, no type" block '{"tool_name":"Agent","tool_input":{"prompt":"x"}}'
check "empty model" block '{"tool_name":"Agent","tool_input":{"model":"","prompt":"x"}}'
check "fable" block '{"tool_name":"Agent","tool_input":{"model":"fable","prompt":"x"}}'
check "Fable, any case" block '{"tool_name":"Agent","tool_input":{"model":"Fable","prompt":"x"}}'
check "older tool name, no model" block '{"tool_name":"Task","tool_input":{"prompt":"x"}}'
check "haiku" quiet '{"tool_name":"Agent","tool_input":{"subagent_type":"Explore","model":"haiku","prompt":"x"}}'
check "sonnet" quiet '{"tool_name":"Agent","tool_input":{"model":"sonnet","prompt":"x"}}'
check "opus" quiet '{"tool_name":"Agent","tool_input":{"model":"opus","prompt":"x"}}'
check "fork, no model" quiet '{"tool_name":"Agent","tool_input":{"subagent_type":"fork","prompt":"x"}}'
check "another tool" quiet '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
check "unreadable input" quiet 'not json'

echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
