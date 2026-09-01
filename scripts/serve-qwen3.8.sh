#!/usr/bin/env bash
# Self-contained model host for the experiment rig. Run on the jupyter box:
#   ~/serve-qwen38.sh                            # serve qwen3.8-mtp over Tailscale
#   RESTART=1 ~/serve-qwen38.sh                  # force a cold reload
#   MODEL=... NUM_PARALLEL=3 ~/serve-qwen38.sh   # override defaults
# Replaces the old tailscale.sh (same tailscale setup, plus llama-server).
#
# Serves Qwen3.8-27B (unsloth UD-IQ3_S + MTP) with llama.cpp's llama-server
# instead of Ollama — same engine underneath, but (eval 31.08, see
# docs/research/model-hosting-31.08.md):
# - Ollama OOMs with q8_0 KV at 65k ctx x 2 slots (MTP draft buffer spike) and
#   must degrade to quality-losing q4_0; llama-server fits (15.2/16GB).
# - Restores an evicted 22k-token agent session in ~2s vs 4.1s, same-slot
#   repeat prompts in 0.3-0.5s vs 2.1-9.7s (incl. one outright miss).
#
# Tuning rationale:
# - NUM_PARALLEL=1   single 64k slot. The workflow is serial (one agent
#                    session at a time) and sessions are fresh per agent/
#                    iteration, so a second slot only idles. The 64k window
#                    keeps contexts under the compaction threshold
#                    (contextWindow - reserveTokens), so prefixes are never
#                    rewritten and the server KV cache stays hot.
# - CONTEXT_LENGTH=65536  single-slot context; must match contextWindow in
#                    packages/core llamaProvider.model.ts (preflight
#                    enforces this via /slots).
# - KV q8_0          q4_0 degrades quality at 30k+ context; q8_0 is ~lossless.
# - --cache-ram +    evicted sessions spill to host RAM (754GB available) and
#   --cache-reuse    partial prefixes (shared TEAM_PREFIX) are reused, killing
#                    the measured P0 re-prefill cost.
# - MTP draft        self-speculative decoding, ~1.6x generation speed
#                    (acceptance 0.8, mean accepted length 2.33).
# - 127.0.0.1 only   tailscale serve is the only public exposure (fixes the
#                    "binds 0.0.0.0" finding).
# - Own model file   lives in ~/.local/share/qwen38/models, independent of
#                    Ollama's blob store (which GCs "unused" blobs).
set -euo pipefail

MODEL="${MODEL:-$HOME/.local/share/qwen38/models/qwen3.8-27b-UD-IQ3_S.gguf}"
NUM_PARALLEL="${NUM_PARALLEL:-1}"
CONTEXT_LENGTH="${CONTEXT_LENGTH:-65536}"
PORT="${PORT:-8080}"
RESTART="${RESTART:-0}"

DIR="$HOME/.local/share/qwen38"
BIN="$HOME/.local/bin"
TS_DIR="$HOME/.local/share/tailscale"
TS_SOCK="$TS_DIR/tailscaled.sock"

# --- tailscale (userspace networking, no root) ---
install() {
  mkdir -p "$BIN" "$TS_DIR"
  if [ ! -f "$BIN/tailscale.real" ]; then
    if [ ! -f "$BIN/tailscale" ]; then
      curl -fsSL https://pkgs.tailscale.com/stable/tailscale_1.98.9_amd64.tgz | tar -xz --strip-components=1 -C "$BIN"
    fi
    mv "$BIN/tailscale" "$BIN/tailscale.real"
    cat >"$BIN/tailscale" <<'WRAP'
#!/bin/bash
exec "$(dirname "$0")/tailscale.real" --socket="$HOME/.local/share/tailscale/tailscaled.sock" "$@"
WRAP
    chmod +x "$BIN/tailscale"
  fi
}

daemon_alive() {
  timeout 5 "$BIN/tailscale" status >/dev/null 2>&1
}

start_daemon() {
  pkill -f "tailscaled.*$TS_SOCK" 2>/dev/null || true
  rm -f "$TS_SOCK"
  nohup "$BIN/tailscaled" --tun=userspace-networking --socket="$TS_SOCK" --state="$TS_DIR/state" >"$TS_DIR/daemon.log" 2>&1 </dev/null &
  disown
  for _ in $(seq 1 20); do daemon_alive && return 0; sleep 1; done
  return 1
}

install
if ! daemon_alive; then
  start_daemon || {
    echo "tailscaled failed to start; tail of $TS_DIR/daemon.log:" >&2
    tail -20 "$TS_DIR/daemon.log" >&2
    exit 1
  }
fi
"$BIN/tailscale" up --hostname=jupyter

# --- llama-server, tuned for the multi-agent loop ---
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; }

if healthy && [ "$RESTART" != "1" ]; then
  echo "already healthy on :$PORT (RESTART=1 to force)"
else
  [ -f "$DIR/server.pid" ] && kill "$(cat "$DIR/server.pid")" 2>/dev/null || true
  export LD_LIBRARY_PATH="$DIR/bin"
  nohup setsid "$DIR/bin/llama-server" \
    -m "$MODEL" \
    --host 127.0.0.1 --port "$PORT" \
    -ngl 999 -c "$CONTEXT_LENGTH" -np "$NUM_PARALLEL" -fa on -ctk q8_0 -ctv q8_0 \
    --cache-ram 16384 --cache-reuse 256 \
    --jinja --reasoning-format auto --spec-type draft-mtp --spec-draft-n-max 2 \
    >"$DIR/server.log" 2>&1 &
  echo $! >"$DIR/server.pid"; disown
  for _ in $(seq 1 300); do healthy && break; sleep 2; done
  healthy || { echo "llama-server failed; tail of $DIR/server.log:"; tail -20 "$DIR/server.log"; exit 1; }
fi

"$BIN/tailscale" serve --bg "$PORT"

# warm the model (builds CUDA graphs + MTP draft path) so the first agent
# call doesn't pay for them
curl -fsS "http://127.0.0.1:$PORT/v1/chat/completions" -H "Content-Type: application/json" \
  -d '{"model":"qwen3.8-mtp","messages":[{"role":"user","content":"ok"}],"max_tokens":1}' >/dev/null

echo "serving qwen3.8-mtp on 127.0.0.1:$PORT ($NUM_PARALLEL slots, $CONTEXT_LENGTH total ctx)"
