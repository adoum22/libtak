#!/usr/bin/env bash
# Foreground companion for start_server.sh: check due reports/backups every
# 10 minutes, optional cloud push every 30 minutes. Failures are logged/retried.

set -Euo pipefail

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
DATA_DIR="$APP_DIR/.libtak-data"
LOG_DIR="$DATA_DIR/logs"
LOCK_FILE="$DATA_DIR/background.lock"
REPORT_LOG="$LOG_DIR/reports.log"
SYNC_LOG="$LOG_DIR/sync.log"
REPORT_INTERVAL=600
SYNC_INTERVAL=1800

if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
else
    echo "Environnement Python LibTak introuvable ; relancez ./install.sh." >&2
    exit 1
fi

umask 077
install -d -m 700 "$DATA_DIR" "$LOG_DIR"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
    echo "Les tâches de fond LibTak sont déjà actives."
    exit 0
fi

cloud_is_configured() {
    (
        cd "$BACKEND_DIR"
        "$PYTHON_BIN" -c \
            "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup(); from django.conf import settings; raise SystemExit(0 if settings.CLOUD_API_URL and settings.SYNC_TOKEN else 1)"
    ) >/dev/null 2>&1
}

run_reports() {
    printf '\n[%s] scheduled reports / backup check\n' "$(date --iso-8601=seconds)" >> "$REPORT_LOG"
    (
        cd "$BACKEND_DIR"
        "$PYTHON_BIN" manage.py send_scheduled_reports
    ) >> "$REPORT_LOG" 2>&1 || echo "Échec du contrôle rapports/sauvegarde ; nouvelle tentative dans 10 minutes." >&2
}

run_sync() {
    if ! cloud_is_configured; then
        return
    fi
    printf '\n[%s] cloud push\n' "$(date --iso-8601=seconds)" >> "$SYNC_LOG"
    (
        cd "$BACKEND_DIR"
        "$PYTHON_BIN" sync_to_cloud.py --push
    ) >> "$SYNC_LOG" 2>&1 || echo "Échec sync cloud ; nouvelle tentative dans 30 minutes." >&2
}

echo "Tâches LibTak actives : contrôle rapports/sauvegarde 10 min, sync configurée 30 min."
next_sync=0
while true; do
    run_reports
    now="$(date +%s)"
    if [ "$now" -ge "$next_sync" ]; then
        run_sync
        next_sync=$((now + SYNC_INTERVAL))
    fi
    sleep "$REPORT_INTERVAL"
done
