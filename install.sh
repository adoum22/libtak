#!/usr/bin/env bash
# Canonical LibTak installer for Zorin OS / Ubuntu.

set -Eeuo pipefail

SYSTEMD_MODE=0
SKIP_SYSTEM_PACKAGES=0

usage() {
    cat <<'EOF'
Usage: ./install.sh [--systemd] [--skip-system-packages]

  --systemd              Install and start hardened systemd services/timers.
  --skip-system-packages Do not call apt; validate existing prerequisites only.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --systemd) SYSTEMD_MODE=1 ;;
        --skip-system-packages) SKIP_SYSTEM_PACKAGES=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Option inconnue: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

trap 'unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_PASSWORD_CONFIRM 2>/dev/null || true' EXIT
trap 'echo "Échec de l’installation à la ligne $LINENO." >&2' ERR

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
DATA_DIR="$APP_DIR/.libtak-data"
BACKUP_DIR="$DATA_DIR/backups"
LOG_DIR="$DATA_DIR/logs"
ENV_FILE="$BACKEND_DIR/.env"
USER_NAME="$(id -un)"
GROUP_NAME="$(id -gn)"

if [ "$(id -u)" -eq 0 ]; then
    echo -e "${RED}N’exécutez pas cet installateur en root.${NC}" >&2
    echo "Relancez-le avec votre compte habituel ; sudo sera demandé uniquement pour apt/systemd." >&2
    exit 1
fi

for required in "$BACKEND_DIR/manage.py" "$BACKEND_DIR/requirements.txt" "$FRONTEND_DIR/package-lock.json"; do
    if [ ! -f "$required" ]; then
        echo "Installation incomplète : fichier absent $required" >&2
        exit 1
    fi
done

if [ ! -w "$APP_DIR" ]; then
    echo "Le dossier $APP_DIR n’est pas inscriptible par $USER_NAME." >&2
    echo "Corrigez son propriétaire avant de relancer l’installation." >&2
    exit 1
fi

echo -e "${YELLOW}[1/8] Vérification des dépendances système${NC}"
if [ "$SKIP_SYSTEM_PACKAGES" -eq 0 ]; then
    if ! command -v apt-get >/dev/null 2>&1 || ! command -v sudo >/dev/null 2>&1; then
        echo "apt-get/sudo introuvable ; utilisez --skip-system-packages après installation manuelle des prérequis." >&2
        exit 1
    fi
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl git libffi-dev libjpeg-dev \
        libpango-1.0-0 libpangoft2-1.0-0 libpq-dev python3 python3-pip \
        python3-venv shared-mime-info xdg-utils zlib1g-dev
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 est requis." >&2
    exit 1
fi
if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
    echo "Python 3.10 ou supérieur est requis." >&2
    exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js avec npm est requis. Installez une version officielle Node 20.19+ ou 22.12+, puis relancez." >&2
    exit 1
fi
if ! node -e "const [major,minor]=process.versions.node.split('.').map(Number); const ok=(major===20&&minor>=19)||(major===22&&minor>=12)||major>22; process.exit(ok?0:1)"; then
    echo "Node.js $(node --version) est incompatible avec Vite 7." >&2
    echo "Installez Node 20.19+ ou 22.12+ depuis une source officielle." >&2
    exit 1
fi
echo "Python $(python3 --version | awk '{print $2}') ; Node $(node --version) ; npm $(npm --version)"

echo -e "${YELLOW}[2/8] Environnement Python${NC}"
if [ -x "$BACKEND_DIR/.venv/bin/python" ]; then
    VENV_DIR="$BACKEND_DIR/.venv"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
    VENV_DIR="$BACKEND_DIR/venv"
else
    VENV_DIR="$BACKEND_DIR/.venv"
    python3 -m venv "$VENV_DIR"
fi
PYTHON_BIN="$VENV_DIR/bin/python"
"$PYTHON_BIN" -m pip install --upgrade pip wheel
"$PYTHON_BIN" -m pip install -r "$BACKEND_DIR/requirements.txt"
"$PYTHON_BIN" -m pip check

echo -e "${YELLOW}[3/8] Configuration privée${NC}"
umask 077
install -d -m 700 "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

append_env_if_missing() {
    local key="$1"
    local value="$2"
    if ! grep -q "^${key}=" "$ENV_FILE"; then
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

append_env_if_missing SECRET_KEY "$("$PYTHON_BIN" -c 'import secrets; print(secrets.token_urlsafe(50))')"
append_env_if_missing JWT_SIGNING_KEY "$("$PYTHON_BIN" -c 'import secrets; print(secrets.token_urlsafe(50))')"
append_env_if_missing BACKUP_ENCRYPTION_KEY "$("$PYTHON_BIN" -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')"
append_env_if_missing BACKUP_RETENTION_DAYS 30
append_env_if_missing LIBTAK_BACKUP_DIR "$BACKUP_DIR"
append_env_if_missing DEBUG False
append_env_if_missing ALLOWED_HOSTS 'localhost,127.0.0.1,[::1]'
append_env_if_missing CORS_ALLOWED_ORIGINS 'http://127.0.0.1:5173,http://localhost:5173'
append_env_if_missing CSRF_TRUSTED_ORIGINS 'http://127.0.0.1:5173,http://localhost:5173'
append_env_if_missing SECURE_SSL_REDIRECT False
append_env_if_missing IS_CLOUD_SERVER False

echo -e "${YELLOW}[4/8] Base de données et contrôles Django${NC}"
(
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" manage.py migrate --noinput
    "$PYTHON_BIN" manage.py collectstatic --noinput
    "$PYTHON_BIN" manage.py check
)

echo -e "${YELLOW}[5/8] Premier administrateur${NC}"
ADMIN_EXISTS=0
if (
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup(); from core.models import User; raise SystemExit(0 if User.objects.filter(role='ADMIN',is_active=True).exclude(password='').exclude(password__startswith='!').exists() else 1)"
); then
    ADMIN_EXISTS=1
fi

if [ "$ADMIN_EXISTS" -eq 0 ] && { [ -z "${BOOTSTRAP_ADMIN_USERNAME:-}" ] || [ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]; }; then
    if [ ! -t 0 ]; then
        echo "Aucun administrateur actif. Relancez dans un terminal ou fournissez BOOTSTRAP_ADMIN_USERNAME et BOOTSTRAP_ADMIN_PASSWORD." >&2
        exit 1
    fi
    read -r -p "Nom du premier administrateur : " BOOTSTRAP_ADMIN_USERNAME
    read -r -p "E-mail administrateur (optionnel) : " BOOTSTRAP_ADMIN_EMAIL
    read -r -s -p "Phrase de passe administrateur : " BOOTSTRAP_ADMIN_PASSWORD
    echo
    read -r -s -p "Confirmez la phrase de passe : " BOOTSTRAP_ADMIN_PASSWORD_CONFIRM
    echo
    if [ -z "$BOOTSTRAP_ADMIN_USERNAME" ] || [ -z "$BOOTSTRAP_ADMIN_PASSWORD" ]; then
        echo "Nom et phrase de passe obligatoires." >&2
        exit 1
    fi
    if [ "$BOOTSTRAP_ADMIN_PASSWORD" != "$BOOTSTRAP_ADMIN_PASSWORD_CONFIRM" ]; then
        echo "Les phrases de passe ne correspondent pas." >&2
        exit 1
    fi
    export BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
fi
(
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" create_users.py
)
unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_PASSWORD_CONFIRM 2>/dev/null || true

echo -e "${YELLOW}[6/8] Frontend reproductible${NC}"
(
    cd "$FRONTEND_DIR"
    npm ci
    VITE_API_URL='http://127.0.0.1:8000/api' npm run build
)
if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
    echo "Le build frontend n’a pas produit dist/index.html." >&2
    exit 1
fi

echo -e "${YELLOW}[7/8] Sauvegarde chiffrée initiale${NC}"
BACKUP_RESULT="$(
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup(); from reporting.tasks import daily_database_backup; print(daily_database_backup())"
)"
LATEST_BACKUP="$(printf '%s\n' "$BACKUP_RESULT" | sed -n 's/^Backup created: //p' | tail -n 1)"
if [ -z "$LATEST_BACKUP" ] || [ ! -f "$LATEST_BACKUP" ]; then
    echo "La tâche de sauvegarde n’a pas renvoyé une archive chiffrée vérifiable." >&2
    exit 1
fi
ACTIVE_BACKUP_DIR="$(dirname -- "$LATEST_BACKUP")"
(
    cd "$BACKEND_DIR"
    "$PYTHON_BIN" manage.py verify_backup "$LATEST_BACKUP"
)

echo -e "${YELLOW}[8/8] Démarrage et tâches de fond${NC}"
chmod 700 "$APP_DIR/start_server.sh" "$APP_DIR/background_tasks.sh" "$APP_DIR/demarrer_libtak.sh" "$APP_DIR/sync_to_cloud.sh"

install_systemd_units() {
    local node_bin node_dir unit_dir temp_dir sync_configured
    node_bin="$(command -v node)"
    node_dir="$(dirname -- "$node_bin")"
    unit_dir='/etc/systemd/system'
    temp_dir="$(mktemp -d)"
    trap 'rm -rf -- "$temp_dir"; unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_PASSWORD_CONFIRM 2>/dev/null || true' EXIT

    cat > "$temp_dir/libtak-backend.service" <<EOF
[Unit]
Description=LibTak ASGI backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory="$BACKEND_DIR"
Environment="PYTHONUNBUFFERED=1"
ExecStartPre="$PYTHON_BIN" manage.py migrate --noinput
ExecStart="$PYTHON_BIN" -m daphne -b 127.0.0.1 -p 8000 config.asgi:application
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

    cat > "$temp_dir/libtak-frontend.service" <<EOF
[Unit]
Description=LibTak built frontend
Requires=libtak-backend.service
After=libtak-backend.service

[Service]
Type=simple
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory="$FRONTEND_DIR"
Environment="PATH=$node_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart="$node_bin" "$FRONTEND_DIR/node_modules/vite/bin/vite.js" preview --host 127.0.0.1 --port 5173 --strictPort
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

    cat > "$temp_dir/libtak-scheduler.service" <<EOF
[Unit]
Description=LibTak reports, JWT cleanup and encrypted backup scheduler
After=libtak-backend.service

[Service]
Type=oneshot
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory="$BACKEND_DIR"
ExecStart="$PYTHON_BIN" manage.py send_scheduled_reports
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077
EOF

    cat > "$temp_dir/libtak-scheduler.timer" <<'EOF'
[Unit]
Description=Run LibTak scheduler every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

    cat > "$temp_dir/libtak-sync.service" <<EOF
[Unit]
Description=Push pending LibTak data to the configured cloud
After=network-online.target libtak-backend.service
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
Group=$GROUP_NAME
WorkingDirectory="$BACKEND_DIR"
ExecStart="$PYTHON_BIN" sync_to_cloud.py --push
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077
EOF

    cat > "$temp_dir/libtak-sync.timer" <<'EOF'
[Unit]
Description=Run configured LibTak cloud sync every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
AccuracySec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

    for unit in "$temp_dir"/*; do
        sudo install -o root -g root -m 0644 "$unit" "$unit_dir/$(basename -- "$unit")"
    done
    sudo systemctl daemon-reload
    sudo systemctl enable --now libtak-backend.service libtak-frontend.service libtak-scheduler.timer

    sync_configured="$(cd "$BACKEND_DIR" && "$PYTHON_BIN" -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings'); import django; django.setup(); from django.conf import settings; print('1' if settings.CLOUD_API_URL and settings.SYNC_TOKEN else '0')")"
    if [ "$sync_configured" = '1' ]; then
        sudo systemctl enable --now libtak-sync.timer
    else
        sudo systemctl disable --now libtak-sync.timer >/dev/null 2>&1 || true
        echo "Synchronisation cloud non activée : configurez CLOUD_API_URL/SYNC_TOKEN puis activez libtak-sync.timer."
    fi
    rm -rf -- "$temp_dir"
    trap 'unset BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_ADMIN_PASSWORD_CONFIRM 2>/dev/null || true' EXIT
}

if [ "$SYSTEMD_MODE" -eq 1 ]; then
    if ! command -v systemctl >/dev/null 2>&1 || ! command -v sudo >/dev/null 2>&1; then
        echo "systemd et sudo sont requis pour --systemd." >&2
        exit 1
    fi
    install_systemd_units
fi

if command -v xdg-open >/dev/null 2>&1; then
    DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || printf '%s/Desktop' "$HOME")"
    mkdir -p "$DESKTOP_DIR"
    SHORTCUT="$DESKTOP_DIR/LibTak.desktop"
    cat > "$SHORTCUT" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=LibTak
Comment=Point de vente Librairie
Exec=xdg-open http://127.0.0.1:5173
Icon=$FRONTEND_DIR/public/icons/icon-512x512.png
Terminal=false
Categories=Office;
EOF
    chmod 700 "$SHORTCUT"
fi

echo
echo -e "${GREEN}Installation LibTak terminée.${NC}"
if [ "$SYSTEMD_MODE" -eq 1 ]; then
    echo "Services démarrés automatiquement par systemd."
else
    echo "Démarrez la pile complète avec : $APP_DIR/start_server.sh"
fi
echo "Application : http://127.0.0.1:5173"
echo "API locale  : http://127.0.0.1:8000/api/"
echo "Sauvegardes : $ACTIVE_BACKUP_DIR"
echo "Conservez backend/.env et BACKUP_ENCRYPTION_KEY dans un coffre privé."
