#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/api/venv"
REQS="$ROOT/api/requirements.txt"
PY_STAMP="$VENV/.requirements.sha256"
NODE_DIR="$ROOT/frontend/node_modules"
LOCK="$ROOT/frontend/package-lock.json"
PKG="$ROOT/frontend/package.json"
NODE_STAMP="$NODE_DIR/.install.sha256"

# ── Python venv + requirements ─────────────────────────────────────────
if [ ! -f "$VENV/bin/activate" ]; then
    echo "[deps] creating venv at $VENV"
    python3 -m venv "$VENV" || { echo "ERROR: failed to create venv" >&2; exit 1; }
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

if [ ! -f "$REQS" ]; then
    echo "ERROR: $REQS not found." >&2
    exit 1
fi

REQS_HASH=$(sha256sum "$REQS" | awk '{print $1}')
if [ ! -f "$PY_STAMP" ] || [ "$(cat "$PY_STAMP")" != "$REQS_HASH" ]; then
    echo "[deps] installing python requirements"
    pip install -q --upgrade pip
    pip install -q -r "$REQS" || { echo "ERROR: pip install failed" >&2; exit 1; }
    echo "$REQS_HASH" > "$PY_STAMP"
fi

if ! command -v uvicorn >/dev/null 2>&1; then
    echo "ERROR: 'uvicorn' not found after install. Check $REQS." >&2
    exit 1
fi

# ── Node deps ──────────────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: 'npm' not found in PATH." >&2
    exit 1
fi

# Prefer lockfile hash; fall back to package.json if lock is absent.
if [ -f "$LOCK" ]; then
    NODE_HASH=$(sha256sum "$LOCK" | awk '{print $1}')
else
    NODE_HASH=$(sha256sum "$PKG" | awk '{print $1}')
fi
if [ ! -d "$NODE_DIR" ] || [ ! -f "$NODE_STAMP" ] || [ "$(cat "$NODE_STAMP")" != "$NODE_HASH" ]; then
    echo "[deps] installing node modules"
    (cd "$ROOT/frontend" && npm install --no-fund --no-audit --loglevel=error) \
        || { echo "ERROR: npm install failed" >&2; exit 1; }
    echo "$NODE_HASH" > "$NODE_STAMP"
fi

cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "Stopping..."
    kill 0 2>/dev/null
    exit 0
}
trap cleanup INT TERM

cd "$ROOT/api"
uvicorn main:app --reload --port 8000 &
API_PID=$!

cd "$ROOT/frontend"
npm run dev &
WEB_PID=$!

cd "$ROOT"

while true; do
    if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "ERROR: uvicorn exited unexpectedly." >&2
        exit 1
    fi
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
        echo "ERROR: vite exited unexpectedly." >&2
        exit 1
    fi
    sleep 1
done
