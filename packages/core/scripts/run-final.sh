#!/usr/bin/env bash
# the final comparison batch. two operating points, three apps, two repeats each.
#
# this is not a model comparison. each cell pins a model together with the
# thinking level it is actually run at, so what is being compared is a
# cheap-and-fast operating point against a maximum-effort one. the 2026-09-01
# overnight 2x2 already separated model from thinking level at one run per cell;
# this batch repeats the two endpoints it identified, so stability and
# decomposition variance stop being stddev-0 placeholders.
#
# cheap cell runs first, so a complete operating point is banked inside the
# first hour even if the batch has to be cut short.
#
# launch detached, from a shell where bun already resolves:
#   setsid nohup bash packages/core/scripts/run-final.sh > output/run-final.stderr 2>&1 < /dev/null & disown
#
# no script(1) pty wrapper: the batch function discards the tui's stdout anyway.
# never send stderr to /dev/null. the bun-on-PATH check exits before the log
# file is created, so a direnv that has not loaded looks like the script doing
# nothing at all.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUN="$(command -v bun || true)"
LOG="$REPO/output/run-final.log"

if [ -z "$BUN" ]; then
  echo "bun not on PATH" >&2
  exit 1
fi

: "${OLLAMA_HOST:=http://100.119.46.106:11434}"
: "${OLLAMA_MAX_TOKENS:=16384}"
export OLLAMA_HOST OLLAMA_MAX_TOKENS
# stamps every summary with the tree that produced it. dirty trees get a suffix
# so a run is never attributed to a commit it did not actually use.
if [ -z "${GIT_COMMIT:-}" ]; then
  GIT_COMMIT="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  git -C "$REPO" diff --quiet 2>/dev/null || GIT_COMMIT="$GIT_COMMIT-dirty"
fi
export GIT_COMMIT

cd "$REPO" || exit 1

log() { echo "$*" >>"$LOG"; }

# refuse to start against a model that is not loaded at the expected context or
# is spilling to cpu. a batch run under either condition is not comparable with
# the batches it is meant to sit beside.
preflight() {
  local code
  code=$(curl -s --max-time 180 "$OLLAMA_HOST/api/generate" \
    -d "{\"model\":\"$OLLAMA_MODEL\",\"keep_alive\":\"90m\",\"stream\":false,\"options\":{\"num_ctx\":$OLLAMA_CONTEXT_WINDOW}}" \
    -o /dev/null -w '%{http_code}')
  if [ "$code" != "200" ]; then
    log "PREFLIGHT FAIL: model load returned HTTP $code"
    return 1
  fi
  curl -s --max-time 30 "$OLLAMA_HOST/api/ps" | python3 -c "
import json,sys,os
want_ctx = int(os.environ['OLLAMA_CONTEXT_WINDOW'])
want_model = os.environ['OLLAMA_MODEL']
models = json.load(sys.stdin).get('models', [])
match = [m for m in models if m['name'].startswith(want_model)]
if not match:
    print('PREFLIGHT FAIL: %s not loaded' % want_model); sys.exit(1)
m = match[0]
ctx, size, vram = m.get('context_length'), m.get('size',0), m.get('size_vram',0)
if ctx != want_ctx:
    print('PREFLIGHT FAIL: loaded ctx %s, expected %s' % (ctx, want_ctx)); sys.exit(1)
if vram < size:
    print('PREFLIGHT FAIL: spilling to CPU, vram %d < size %d' % (vram, size)); sys.exit(1)
print('preflight ok: ctx %s, fully resident %.2f GB' % (ctx, size/1e9))
" >>"$LOG" 2>&1
}

# batch <model> <ctx> <thinking level> <spec file> <output subdir>
batch() {
  local model="$1" ctx="$2" level="$3" spec="$4" subdir="$5" rc
  export OLLAMA_MODEL="$model" OLLAMA_CONTEXT_WINDOW="$ctx"
  log ""
  log "==================== $(date -Is)  batch $subdir  model $model ctx $ctx level $level"
  if ! preflight; then
    log "SKIPPING $subdir, preflight failed"
    return 1
  fi
  # the tui redraws on every event, so its stdout is discarded. the full report
  # persists as output/<subdir>/experiment-<ts>.json regardless.
  THINKING_LEVEL="$level" "$BUN" --cwd packages/core scripts/experiment.ts \
    "packages/core/scripts/$spec" "--output-subdir=$subdir" \
    >/dev/null 2>>"$LOG"
  rc=$?
  log "==================== $(date -Is)  batch $subdir finished, exit $rc"
  return 0
}

: >"$LOG"
log "started $(date -Is), commit $GIT_COMMIT, host $OLLAMA_HOST"

SPEC=experiment-final-3apps-r2.json

batch qwen3.6-mtp-tuned  26624 low    "$SPEC" final-3.6-low
batch qwen3.8-iq3s-tuned 65536 medium "$SPEC" final-3.8-medium

log ""
log "==================== $(date -Is)  all batches done, reclassifying"
"$BUN" --cwd packages/core scripts/reclassifyRuns.ts \
  >"$REPO/output/reclassify-final.md" 2>>"$LOG"
log "reclassification written to output/reclassify-final.md"
log "DONE $(date -Is)"
