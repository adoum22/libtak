#!/usr/bin/env bash
# Start the complete local LibTak stack (API, built frontend and background jobs).

set -Eeuo pipefail

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
else
    PYTHON_BIN="$(command -v python3 || true)"
fi

if [ -z "${PYTHON_BIN:-}" ]; then
    echo "Erreur: Python 3 est introuvable. Exécutez ./install.sh."
    exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "Erreur: npm est introuvable. Exécutez ./install.sh."
    exit 1
fi

if [ ! -f "$FRONTEND_DIR/dist/index.html" ] || [ "${LIBTAK_REBUILD_FRONTEND:-0}" = "1" ]; then
    echo "Construction du frontend local..."
    (
        cd "$FRONTEND_DIR"
        if [ ! -d node_modules ]; then npm ci; fi
        VITE_API_URL="http://127.0.0.1:8000/api" npm run build
    )
fi

cd "$BACKEND_DIR"
"$PYTHON_BIN" manage.py migrate --noinput
"$PYTHON_BIN" manage.py check

BACKEND_PID=""
FRONTEND_PID=""
BACKGROUND_PID=""

cleanup() {
    trap - EXIT INT TERM
    for process_id in "$BACKGROUND_PID" "$FRONTEND_PID" "$BACKEND_PID"; do
        if [ -n "$process_id" ]; then kill "$process_id" 2>/dev/null || true; fi
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Démarrage de l'API ASGI sur http://127.0.0.1:8000 ..."
(cd "$BACKEND_DIR" && "$PYTHON_BIN" -m daphne -b 127.0.0.1 -p 8000 config.asgi:application) &
BACKEND_PID=$!

echo "Démarrage de l'application sur http://127.0.0.1:5173 ..."
(cd "$FRONTEND_DIR" && npm run preview -- --host 127.0.0.1 --port 5173 --strictPort) &
FRONTEND_PID=$!

if [ "${LIBTAK_DISABLE_BACKGROUND_TASKS:-0}" != "1" ]; then
    bash "$APP_DIR/background_tasks.sh" &
    BACKGROUND_PID=$!
fi

echo "LibTak est prêt. Ouvrez http://127.0.0.1:5173 (Ctrl+C pour arrêter)."
wait -n "$BACKEND_PID" "$FRONTEND_PID"
