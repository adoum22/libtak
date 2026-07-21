#!/bin/bash
# ============================================
#   LibTak - Script d'installation
#   Pour Zorin OS 17.3 / Ubuntu / Linux
# ============================================

set -e

# Couleurs
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
echo "============================================"
echo "   LibTak - Installation"
echo "   Librairie Attaquaddoum"
echo "============================================"
echo -e "${NC}"

# Vérifier Python
echo -e "${YELLOW}Vérification de Python...${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✓ $PYTHON_VERSION installé${NC}"
else
    echo -e "${RED}✗ Python3 n'est pas installé${NC}"
    echo "Installation de Python3..."
    sudo apt update
    sudo apt install -y python3 python3-pip python3-venv
fi

# Vérifier pip
echo -e "${YELLOW}Vérification de pip...${NC}"
if command -v pip3 &> /dev/null; then
    echo -e "${GREEN}✓ pip3 installé${NC}"
else
    echo "Installation de pip3..."
    sudo apt install -y python3-pip
fi

# Aller dans le dossier de l'application
APP_DIR="$(dirname "$0")"
cd "$APP_DIR"

echo -e "${YELLOW}Dossier de l'application: $(pwd)${NC}"

# Créer l'environnement virtuel
echo -e "${YELLOW}Création de l'environnement virtuel...${NC}"
cd backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✓ Environnement virtuel créé${NC}"
else
    echo -e "${GREEN}✓ Environnement virtuel existe déjà${NC}"
fi

# Activer l'environnement virtuel
source venv/bin/activate

# Installer les dépendances
echo -e "${YELLOW}Installation des dépendances Python...${NC}"
pip install --upgrade pip
pip install -r requirements.txt
echo -e "${GREEN}✓ Dépendances installées${NC}"

# Créer une configuration locale propre à cette installation sans écraser
# un fichier existant.
if [ ! -f ".env" ]; then
    umask 077
    LOCAL_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
    LOCAL_JWT_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
    cat > .env << EOF
SECRET_KEY=$LOCAL_SECRET_KEY
JWT_SIGNING_KEY=$LOCAL_JWT_KEY
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
IS_CLOUD_SERVER=False
EOF
    unset LOCAL_SECRET_KEY LOCAL_JWT_KEY
    chmod 600 .env
    echo -e "${GREEN}✓ Configuration locale sécurisée créée${NC}"
else
    echo -e "${GREEN}✓ Configuration locale existante préservée${NC}"
fi

# Migrer la base de données
echo -e "${YELLOW}Configuration de la base de données...${NC}"
python manage.py migrate
echo -e "${GREEN}✓ Base de données configurée${NC}"

# Créer le premier administrateur de manière interactive si nécessaire.
if python manage.py shell -c "from core.models import User; raise SystemExit(0 if User.objects.filter(role='ADMIN', is_active=True).exclude(password='').exclude(password__startswith='!').exists() else 1)"; then
    python create_users.py
else
    echo -e "${YELLOW}Création du premier administrateur (mot de passe non affiché)...${NC}"
    python manage.py createsuperuser
    python create_users.py
fi

# Synchroniser les produits depuis le cloud
echo -e "${YELLOW}Téléchargement des produits depuis le cloud...${NC}"
python sync_to_cloud.py --pull || echo -e "${YELLOW}⚠ Pas de connexion internet ou serveur cloud indisponible${NC}"

# Rendre les scripts exécutables
cd ..
chmod +x start_server.sh
chmod +x sync_to_cloud.sh

echo ""
echo -e "${GREEN}============================================"
echo "   ✓ INSTALLATION TERMINÉE !"
echo "============================================${NC}"
echo ""
echo "Pour démarrer l'application :"
echo -e "  ${BLUE}./start_server.sh${NC}"
echo ""
echo "Pour synchroniser manuellement :"
echo -e "  ${BLUE}./sync_to_cloud.sh${NC}"
echo ""
echo "Ouvrez ensuite le navigateur sur :"
echo -e "  ${GREEN}http://localhost:8000${NC}"
echo ""
