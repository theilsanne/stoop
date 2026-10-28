#!/usr/bin/env bash
# SessionStart hook — cloud sessions only. Installs the app's dependencies so
# `npm run build` (tsc, then Vite) runs from the first command. The repo root
# has no dependencies: the tests run on Node 22.6+ alone.
#
# Synchronous and idempotent: `npm install` is a no-op on a warm node_modules,
# and the cloud runtime snapshots the container after the hook.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}/app"

# `install` rather than `ci`, so a warm node_modules from the snapshot is reused.
npm install --no-audit --no-fund

echo "session-start: app dependencies installed (npm run build is ready)."
