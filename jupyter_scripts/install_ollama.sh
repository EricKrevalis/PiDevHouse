#!/bin/bash
set -eu

LOCAL_DIR="$HOME/.local"
BIN_DIR="$LOCAL_DIR/bin"
LIB_DIR="$LOCAL_DIR/lib"
MODEL_DIR="$HOME/.ollama/models"
OLLAMA_BIN="$BIN_DIR/ollama"

[ -x "$OLLAMA_BIN" ] && [ "${1:-}" != "--update" ] && echo "ollama: already installed" && exit 0

mkdir -p "$BIN_DIR" "$LIB_DIR" "$MODEL_DIR"

echo "ollama: downloading..."
rm -rf "$OLLAMA_BIN" "$LIB_DIR/ollama" "$BIN_DIR/bin" "$BIN_DIR/lib"
curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | zstd -d | tar -xf - -C "$LOCAL_DIR"
rm -rf "$BIN_DIR/bin" "$BIN_DIR/lib"

pkill -f "ollama serve" 2>/dev/null || true
sleep 1

export OLLAMA_MODELS="$MODEL_DIR"
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"
export OLLAMA_FLASH_ATTENTION="true"
export OLLAMA_KV_CACHE_TYPE="q8_0"
export OLLAMA_CONTEXT_LENGTH="65536"

echo "ollama: starting server..."
nohup "$OLLAMA_BIN" serve >/tmp/ollama.log 2>&1 &

for i in $(seq 1 15); do
    curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
done

echo "ollama: $("$OLLAMA_BIN" --version)"
