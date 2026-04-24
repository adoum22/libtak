#!/bin/bash
# ============================================
#   LibTak - Tâches de fond (Sync & Reports)
#   S'exécute en boucle infinie tant que l'app tourne.
# ============================================

APP_DIR="/home/librairie/libtak"
INTERVAL=1800  # 30 minutes en secondes

echo "Starting background tasks (Interval: 30 min)..."

while true; do
    echo "----------------------------------------"
    echo "⏰ Execution des taches de fond : $(date)"
    
    # 1. Synchronisation Cloud (Ventes & Stocks)
    echo "🔄 Lancement de la synchronisation..."
    cd "$APP_DIR"
    # Utiliser le Python du backend
    ./backend/venv/bin/python backend/sync_to_cloud.py >> "$APP_DIR/sync.log" 2>&1
    
    # 2. Envoi des rapports (si nécessaire)
    echo "📧 Vérification des rapports à envoyer..."
    # send_reports.py gère lui-même la non-duplication via ReportLog
    ./backend/venv/bin/python backend/send_reports.py >> "$APP_DIR/reports.log" 2>&1

    echo "✅ Tâches terminees. Pause de 30 min."
    echo "----------------------------------------"
    
    sleep $INTERVAL
done
