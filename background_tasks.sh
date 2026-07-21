#!/bin/bash
# ============================================
#   LibTak - Tâches de fond (Sync & Reports)
#   S'exécute en boucle infinie tant que l'app tourne.
# ============================================

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
if [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
elif [ -x "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
else
    PYTHON_BIN="python3"
fi
INTERVAL=1800  # 30 minutes en secondes

echo "Starting background tasks (Interval: 30 min)..."

while true; do
    echo "----------------------------------------"
    echo "⏰ Execution des taches de fond : $(date)"
    
    # 1. Synchronisation Cloud (Ventes & Stocks)
    echo "🔄 Lancement de la synchronisation..."
    cd "$SCRIPT_DIR" || exit 1
    "$PYTHON_BIN" backend/sync_to_cloud.py --push >> "$SCRIPT_DIR/sync.log" 2>&1
    
    # 2. Envoi des rapports (si nécessaire)
    echo "📧 Vérification des rapports à envoyer..."
    # send_reports.py gère lui-même la non-duplication via ReportLog
    "$PYTHON_BIN" backend/send_reports.py >> "$SCRIPT_DIR/reports.log" 2>&1

    echo "✅ Tâches terminees. Pause de 30 min."
    echo "----------------------------------------"
    
    sleep $INTERVAL
done
