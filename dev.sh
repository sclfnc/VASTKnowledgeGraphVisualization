#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/api/venv"

if [ -f "$VENV/bin/activate" ]; then
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
fi

if ! command -v uvicorn >/dev/null 2>&1; then
    echo "ERROR: 'uvicorn' not found. Expected venv at $VENV." >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: 'npm' not found in PATH." >&2
    exit 1
fi

cleanup() {
    echo ""
    echo "Stopping..."
    kill 0
}
trap cleanup EXIT INT TERM

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
