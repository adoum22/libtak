#!/bin/bash
# ============================================
#   LibTak - Synchronisation vers le cloud
#   Pour Zorin OS / Ubuntu / Linux
# ============================================

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Aller dans le dossier backend
cd "$(dirname "$0")/backend" || exit 1

echo -e "${BLUE}"
echo "============================================"
echo "   LibTak - Synchronisation vers le cloud"
echo "   $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo -e "${NC}"

# Activer l'environnement virtuel si présent
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
fi

# Sauvegarde quotidienne + rapports dus + synchronisation best-effort.
python3 manage.py local_backup_sync
EXIT_CODE=$?

echo ""
echo -e "${GREEN}Synchronisation terminée.${NC}"
echo ""
exit $EXIT_CODE
