#!/bin/zsh
# Development startup script for the Simply task manager.
# Designed to be launchd-friendly (no interactive shell assumptions).

set -euo pipefail

# Provide a predictable PATH (covers common Homebrew Intel/ARM locations plus system paths)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Resolve project root (this script is expected in scripts/ under the repo)
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_DIR"

echo "[simply-dev] Working directory: $PROJECT_DIR"

# Locate npm (prefer first on PATH). Fail early if absent.
if command -v npm >/dev/null 2>&1; then
  NPM_BIN="$(command -v npm)"
else
  echo "[simply-dev] ERROR: npm not found in PATH=$PATH" >&2
  exit 127
fi

# One-time dependency install if node_modules missing
if [ ! -d node_modules ]; then
  echo "[simply-dev] node_modules missing – installing dependencies..."
  "$NPM_BIN" install
fi

echo "[simply-dev] Starting dev server (npm run dev)..."
exec "$NPM_BIN" run dev

# Notes:
# 1. Make executable: chmod +x scripts/simply-dev.sh
# 2. LaunchAgent example ProgramArguments entry:
#    <array>
#      <string>/bin/zsh</string>
#      <string>-c</string>
#      <string>$HOME/GitHub/steffen/simply/scripts/simply-dev.sh</string>
#    </array>
# 3. For production replace final line with: exec "$NPM_BIN" start
