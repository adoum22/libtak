#!/bin/bash
# ============================================
#   LibTak - Démarrage complet de l'application
#   Double-cliquez sur l'icône pour tout lancer !
# ============================================

# Chemin de l'application
APP_DIR="/home/librairie/libtak"

# Afficher un message de démarrage
echo "============================================"
echo "   🚀 Démarrage de LibTak..."
echo "============================================"
echo ""

# Aller dans le dossier de l'application
cd "$APP_DIR" || { echo "❌ Erreur: Impossible d'accéder à $APP_DIR"; read -p "Appuyez sur Entrée..."; exit 1; }

# Vérifier et activer l'environnement virtuel Python
echo "📦 Activation de l'environnement Python..."
if [ -f "backend/venv/bin/activate" ]; then
    source backend/venv/bin/activate
else
    echo "❌ Erreur: Environnement virtuel non trouvé !"
    echo "Veuillez exécuter: cd $APP_DIR/backend && python3 -m venv venv && pip install -r requirements.txt"
    read -p "Appuyez sur Entrée pour fermer..."
    exit 1
fi

# Démarrer le backend Django
echo "📦 Démarrage du serveur backend (port 8000)..."
cd "$APP_DIR/backend"

python manage.py runserver 0.0.0.0:8000 &
BACKEND_PID=$!
sleep 3

# Démarrer le frontend
echo "🎨 Démarrage du serveur frontend (port 5173)..."
cd "$APP_DIR/frontend/dist"
python3 -m http.server 5173 --bind 0.0.0.0 &
FRONTEND_PID=$!
sleep 2

# Démarrer les tâches de fond (Sync & Reports)
echo "🔄 Démarrage des tâches de fond (Sync auto)..."
bash "$APP_DIR/background_tasks.sh" &
BG_TASKS_PID=$!

echo ""
echo "============================================"
echo "   ✅ LibTak est prêt !"
echo "============================================"
echo ""
echo "L'application est accessible sur : http://localhost:5173"
echo ""

# Ouvrir le navigateur automatiquement
echo "🌐 Ouverture du navigateur..."
xdg-open "http://localhost:5173" 2>/dev/null &

echo ""
echo "============================================"
echo "   Pour ARRÊTER l'application :"
echo "   Fermez cette fenêtre ou appuyez sur Ctrl+C"
echo "============================================"
echo ""

# Fonction pour arrêter proprement
cleanup() {
    echo ""
    echo "🛑 Arrêt de l'application..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    kill $BG_TASKS_PID 2>/dev/null
    echo "✅ Application arrêtée."
    exit 0
}

# Capturer Ctrl+C et fermeture de fenêtre
trap cleanup SIGINT SIGTERM

# Garder le script ouvert
wait
