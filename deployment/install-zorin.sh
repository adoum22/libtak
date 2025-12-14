#!/bin/bash
# ============================================================
# INSTALLATION SCRIPT FOR LIBRAIRIE POS
# For Zorin OS 17 / Ubuntu-based systems
# ============================================================

set -e  # Exit on any error

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     INSTALLATION - LIBRAIRIE POS                             ║"
echo "║     Pour Zorin OS 17 / Ubuntu                                ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================
# 1. INSTALL DEPENDENCIES
# ============================================================
echo -e "${YELLOW}[1/6]${NC} Installation des dépendances système..."

sudo apt update
sudo apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    curl \
    chromium-browser

echo -e "${GREEN}✓${NC} Dépendances installées"

# ============================================================
# 2. CREATE APP DIRECTORY
# ============================================================
echo -e "${YELLOW}[2/6]${NC} Création du répertoire de l'application..."

APP_DIR="/opt/librairie-pos"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

cd $APP_DIR

echo -e "${GREEN}✓${NC} Répertoire créé: $APP_DIR"

# ============================================================
# 3. DOWNLOAD APPLICATION
# ============================================================
echo -e "${YELLOW}[3/6]${NC} Téléchargement de l'application..."

# Option A: Clone from Git (if you have a repo)
# git clone https://github.com/your-username/librairie-pos.git .

# Option B: Copy from USB/network drive
# cp -r /source/path/* .

echo -e "${YELLOW}⚠️  ATTENTION: Copiez les fichiers de l'application dans $APP_DIR${NC}"
echo "   Appuyez sur Entrée une fois les fichiers copiés..."
read

echo -e "${GREEN}✓${NC} Fichiers copiés"

# ============================================================
# 4. SETUP BACKEND
# ============================================================
echo -e "${YELLOW}[4/6]${NC} Configuration du backend Python..."

cd $APP_DIR/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Create local settings
cat > .env << EOF
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
EOF

# Initialize database
python manage.py migrate
python manage.py collectstatic --noinput

# Create default users
python manage.py shell -c "
from core.models import User, AppSettings
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', 'admin@librairie.com', 'admin123', role='ADMIN')
    print('Admin créé: admin / admin123')
AppSettings.objects.get_or_create(id=1)
print('Configuration initialisée')
"

echo -e "${GREEN}✓${NC} Backend configuré"

# ============================================================
# 5. SETUP FRONTEND
# ============================================================
echo -e "${YELLOW}[5/6]${NC} Configuration du frontend..."

cd $APP_DIR/frontend

# Install dependencies
npm install

# Build for production
npm run build

echo -e "${GREEN}✓${NC} Frontend configuré"

# ============================================================
# 6. CREATE SYSTEMD SERVICE
# ============================================================
echo -e "${YELLOW}[6/6]${NC} Configuration du démarrage automatique..."

# Create Django service
sudo tee /etc/systemd/system/librairie-backend.service > /dev/null << EOF
[Unit]
Description=Librairie POS Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR/backend
Environment=PATH=$APP_DIR/backend/venv/bin
ExecStart=$APP_DIR/backend/venv/bin/gunicorn config.wsgi:application --bind 127.0.0.1:8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Create Frontend service (serve static files)
sudo tee /etc/systemd/system/librairie-frontend.service > /dev/null << EOF
[Unit]
Description=Librairie POS Frontend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR/frontend
ExecStart=/usr/bin/npx serve -s dist -l 5173
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable librairie-backend librairie-frontend
sudo systemctl start librairie-backend librairie-frontend

echo -e "${GREEN}✓${NC} Services configurés"

# ============================================================
# CREATE DESKTOP SHORTCUT
# ============================================================
echo "Création du raccourci bureau..."

cat > ~/Desktop/Librairie-POS.desktop << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Librairie POS
Comment=Point de Vente Librairie
Exec=chromium-browser --app=http://localhost:5173 --start-fullscreen
Icon=$APP_DIR/frontend/public/icons/icon-512x512.png
Terminal=false
Categories=Office;
EOF

chmod +x ~/Desktop/Librairie-POS.desktop

# ============================================================
# DONE
# ============================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     INSTALLATION TERMINÉE !                                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  🌐 URL: http://localhost:5173                               ║"
echo "║  👤 Admin: admin / admin123                                  ║"
echo "║  📁 Dossier: $APP_DIR                                        ║"
echo "║                                                              ║"
echo "║  L'application démarre automatiquement au boot.             ║"
echo "║  Un raccourci a été créé sur le bureau.                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Changez le mot de passe admin après connexion !${NC}"
