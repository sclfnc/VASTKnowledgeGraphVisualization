#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/api/venv"
REQS="$ROOT/api/requirements.txt"
DEV_REQS="$ROOT/api/requirements-dev.txt"
PY_STAMP="$VENV/.requirements.sha256"
DEV_STAMP="$VENV/.requirements-dev.sha256"

# --dev also installs the test-only deps (pytest, httpx).
# --log streams full pip/npm output (default: quiet, only [deps] lines show).
INSTALL_DEV=0
VERBOSE=0
for arg in "$@"; do
    case "$arg" in
        --dev) INSTALL_DEV=1 ;;
        --log) VERBOSE=1 ;;
        *) echo "ERROR: unknown option '$arg' (supported: --dev, --log)" >&2; exit 1 ;;
    esac
done

# Quiet flags applied unless --log: pip -q, npm --loglevel=error.
PIP_QUIET=(-q)
NPM_QUIET=(--loglevel=error)
if [ "$VERBOSE" -eq 1 ]; then
    PIP_QUIET=()
    NPM_QUIET=()
fi
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
    # networkit builds from source and is slow — pass --log to watch progress.
    echo "[deps] installing python requirements"
    pip install "${PIP_QUIET[@]}" --upgrade pip
    pip install "${PIP_QUIET[@]}" -r "$REQS" || { echo "ERROR: pip install failed" >&2; exit 1; }
    echo "$REQS_HASH" > "$PY_STAMP"
fi

if [ "$INSTALL_DEV" -eq 1 ] && [ -f "$DEV_REQS" ]; then
    DEV_HASH=$(sha256sum "$DEV_REQS" | awk '{print $1}')
    if [ ! -f "$DEV_STAMP" ] || [ "$(cat "$DEV_STAMP")" != "$DEV_HASH" ]; then
        echo "[deps] installing python dev requirements"
        pip install "${PIP_QUIET[@]}" -r "$DEV_REQS" || { echo "ERROR: dev pip install failed" >&2; exit 1; }
        echo "$DEV_HASH" > "$DEV_STAMP"
    fi

    # Run the suite as a non-blocking check. Run from api/ so the top-level
    # `from main import ...` resolves. On failure, surface each failing test
    # with its one-line error (pytest --tb=line) but keep going — some failures
    # are environmental (e.g. test_default_graph_file needs the non-redistributable
    # MC1 default graph), so a red suite must not block local development.
    echo "[test] running API test suite"
    TEST_LOG=$(cd "$ROOT/api" && python3 -m pytest -q --tb=line tests/ 2>&1)
    TEST_RC=$?
    echo "$TEST_LOG"
    if [ "$TEST_RC" -ne 0 ]; then
        echo "" >&2
        echo "WARNING: some API tests failed (continuing anyway):" >&2
        echo "$TEST_LOG" \
            | grep -E '^(FAILED|ERROR) ' \
            | sed 's/^/  /' >&2
        echo "" >&2
    fi
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
    (cd "$ROOT/frontend" && npm install --no-fund --no-audit "${NPM_QUIET[@]}") \
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
