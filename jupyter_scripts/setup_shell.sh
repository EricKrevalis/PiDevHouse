#!/bin/bash
set -eu

cd "$(dirname "$0")"

echo "=== setup ==="
bash install_fzf.sh
bash install_ollama.sh

BASHRC="$HOME/.bashrc"

cat > "$HOME/.bash_profile" <<'EOF'
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
EOF

BLOCK=$(cat <<'BLOCK'
# === OPTS ===
# ssh
chmod 700 ~/.ssh
chmod 600 ~/.ssh/id_ed25519
# fzf
[ -f "$HOME/.fzf.bash" ] && source "$HOME/.fzf.bash"
# ollama
export PATH="$HOME/.local/bin:$PATH"
export OLLAMA_MODELS="$HOME/.ollama/models"
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_ORIGINS="*"
export OLLAMA_FLASH_ATTENTION="true"
export OLLAMA_KV_CACHE_TYPE="q8_0"
export OLLAMA_CONTEXT_LENGTH="65536"
# === /OPTS ===
BLOCK
)

grep -qF "# === OPTS ===" "$BASHRC" 2>/dev/null && sed -i '/^# === OPTS ===$/,/^# === \/OPTS ===$/d' "$BASHRC"
echo "" >> "$BASHRC"
echo "$BLOCK" >> "$BASHRC"

echo "=== setup done ==="
