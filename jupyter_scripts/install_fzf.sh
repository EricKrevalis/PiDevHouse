#!/bin/bash
set -eu

FZF_DIR="$HOME/.fzf"
[ -x "$FZF_DIR/bin/fzf" ] && echo "fzf: already installed" && exit 0

echo "fzf: installing..."
git clone --depth 1 https://github.com/junegunn/fzf.git "$FZF_DIR"
"$FZF_DIR/install" --bin --no-bash --no-fish --no-zsh
echo "fzf: done"
