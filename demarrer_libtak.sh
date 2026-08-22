#!/usr/bin/env bash
# Desktop-friendly alias for the canonical complete start script.

set -Eeuo pipefail
APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if command -v xdg-open >/dev/null 2>&1; then
    (sleep 3; xdg-open "http://127.0.0.1:5173" >/dev/null 2>&1 || true) &
fi

exec "$APP_DIR/start_server.sh"
