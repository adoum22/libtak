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
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Exécuter le script de synchronisation
python3 sync_to_cloud.py

echo ""
echo -e "${GREEN}Synchronisation terminée.${NC}"
echo ""
