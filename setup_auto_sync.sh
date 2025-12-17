#!/bin/bash
# ============================================
#   LibTak - Configuration de la sync automatique
#   Crée une tâche cron toutes les 30 minutes
# ============================================

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Chemin absolu du script de sync
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_SCRIPT="$APP_DIR/sync_to_cloud.sh"

echo -e "${YELLOW}Configuration de la synchronisation automatique...${NC}"
echo "Script de sync: $SYNC_SCRIPT"

# Vérifier que le script existe
if [ ! -f "$SYNC_SCRIPT" ]; then
    echo "Erreur: $SYNC_SCRIPT n'existe pas"
    exit 1
fi

# Rendre le script exécutable
chmod +x "$SYNC_SCRIPT"

# Créer l'entrée cron (toutes les 30 minutes)
CRON_ENTRY="*/30 * * * * $SYNC_SCRIPT >> $APP_DIR/sync.log 2>&1"

# Vérifier si l'entrée existe déjà
if crontab -l 2>/dev/null | grep -q "sync_to_cloud.sh"; then
    echo -e "${YELLOW}La tâche cron existe déjà. Mise à jour...${NC}"
    # Supprimer l'ancienne entrée
    crontab -l 2>/dev/null | grep -v "sync_to_cloud.sh" | crontab -
fi

# Ajouter la nouvelle entrée cron
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo ""
echo -e "${GREEN}✓ Synchronisation automatique configurée !${NC}"
echo ""
echo "La synchronisation s'exécutera toutes les 30 minutes."
echo "Les logs sont dans: $APP_DIR/sync.log"
echo ""
echo "Pour voir les tâches cron:"
echo "  crontab -l"
echo ""
echo "Pour supprimer la tâche cron:"
echo "  crontab -l | grep -v 'sync_to_cloud.sh' | crontab -"
echo ""
