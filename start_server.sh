#!/bin/bash
# ============================================
#   LibTak - Démarrer le serveur local
#   Pour Zorin OS / Ubuntu / Linux
# ============================================

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Aller dans le dossier backend
cd "$(dirname "$0")/backend" || exit 1

echo -e "${BLUE}"
echo "============================================"
echo "   LibTak - Serveur Local"
echo "   Librairie Attaquaddoum"
echo "============================================"
echo -e "${NC}"
echo ""
echo -e "${GREEN}Le serveur démarre...${NC}"
echo "Ouvrez votre navigateur sur: http://localhost:8000"
echo ""
echo "Pour arrêter le serveur, appuyez sur Ctrl+C"
echo "============================================"
echo ""

# Activer l'environnement virtuel si présent
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Démarrer le serveur Django
python3 manage.py runserver 0.0.0.0:8000
