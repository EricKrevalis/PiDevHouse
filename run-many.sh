#!/usr/bin/env bash
set -euo pipefail

COUNT="${1:-1}"

for i in $(seq 1 "$COUNT"); do
  echo "=== run $i/$COUNT ==="
  log="$(mktemp)"
  deno task --filter @pidev/core start >"$log" 2>&1 &
  pid=$!
  until grep -qE "Run completed|Run incomplete|Run blocked" "$log" 2>/dev/null; do
    kill -0 "$pid" 2>/dev/null || { echo "process died early:"; tail -5 "$log"; exit 1; }
    sleep 2
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  tail -1 "$log"
done
