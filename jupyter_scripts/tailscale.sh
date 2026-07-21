#!/bin/bash
set -u
BIN="$HOME/.local/bin"
DIR="$HOME/.local/share/tailscale"
SOCK="$DIR/tailscaled.sock"

install() {
  mkdir -p "$BIN" "$DIR"
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

start_daemon() {
  pkill -f "tailscaled.*$SOCK" 2>/dev/null || true
  nohup "$BIN/tailscaled" --tun=userspace-networking --socket="$SOCK" --state="$DIR/state" >"$DIR/daemon.log" 2>&1 &
  disown
  for _ in $(seq 1 10); do [ -S "$SOCK" ] && break; sleep 1; done
}

install
[ -S "$SOCK" ] && [ "${1:-}" != "--update" ] || start_daemon

"$BIN/tailscale" up --hostname=jupyter

pkill -9 -f "ollama" 2>/dev/null || true
sleep 2
export OLLAMA_HOST=http://0.0.0.0:11434
nohup "$BIN/ollama" serve >"$HOME/.ollama/server.log" 2>&1 &
disown
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done

"$BIN/tailscale" serve reset 2>/dev/null
"$BIN/tailscale" serve --bg 11434
