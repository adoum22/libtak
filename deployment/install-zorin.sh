#!/usr/bin/env bash
# Zorin/Ubuntu system installation entry point. The implementation is kept in
# the root installer so local and systemd installs cannot drift apart.

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$APP_DIR/install.sh"

if [ ! -x "$INSTALLER" ]; then
    chmod 700 "$INSTALLER"
fi

echo "Installation système de LibTak depuis : $APP_DIR"
exec "$INSTALLER" --systemd "$@"
