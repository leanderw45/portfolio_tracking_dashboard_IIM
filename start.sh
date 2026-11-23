#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3,11))'; then PY="$c"; break; fi
  done
fi
[ -n "$PY" ] || { echo "Python 3.11+ is required"; exit 1; }

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  echo "› Creating backend virtualenv with $PY"
  "$PY" -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q --upgrade pip
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "› Installing frontend dependencies"
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "› Backend  → http://127.0.0.1:8000"
(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning) &
echo "› Frontend → http://localhost:5173"
(cd "$ROOT/frontend" && npm run dev -- --host localhost --port 5173 --strictPort) &
wait
