#!/usr/bin/env bash
set -euo pipefail

COUNT="${1:-1}"

for i in $(seq 1 "$COUNT"); do
  echo "=== run $i/$COUNT ==="
  deno run -A packages/core/src/main.ts
done
