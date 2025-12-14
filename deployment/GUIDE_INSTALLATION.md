# Guide d'Installation - Librairie POS

## Prérequis

- **PC dédié** avec connexion internet
- **Zorin OS 17 Lite** (recommandé) ou Ubuntu 22.04+
- 4 GB RAM minimum
- 50 GB espace disque

---

## Installation Express (5 minutes)

### 1. Télécharger Zorin OS 17 Lite
- Aller sur [zorin.com/os/download](https://zorin.com/os/download/)
- Télécharger **Zorin OS 17 Lite** (version légère)
- Créer une clé USB bootable avec [Rufus](https://rufus.ie) ou [Balena Etcher](https://etcher.balena.io)

### 2. Installer Zorin OS
- Démarrer le PC depuis la clé USB
- Suivre l'assistant d'installation
- Choisir "Effacer le disque et installer"

### 3. Installer l'application

Ouvrir un terminal (`Ctrl + Alt + T`) et exécuter :

```bash
# Copier l'application sur une clé USB et la transférer vers /opt/librairie-pos
# Puis exécuter le script d'installation :

cd /opt/librairie-pos/deployment
chmod +x install-zorin.sh
./install-zorin.sh
```

---

## Configuration Cloud (accès distant)

### Sur Render.com (gratuit)

1. Créer un compte sur [render.com](https://render.com)
2. Cliquer "New" → "Blueprint"
3. Connecter votre dépôt GitHub
4. Le fichier `render.yaml` configure tout automatiquement

### Configurer la synchronisation

Sur le PC local, éditer le fichier `/opt/librairie-pos/backend/.env` :

```env
CLOUD_API_URL=https://votre-app.onrender.com/api
SYNC_TOKEN=un_secret_partage_long_et_complexe
```

Sur Render.com, ajouter la même variable `SYNC_TOKEN`.

---

## Utilisation quotidienne

| Action | Comment |
|--------|---------|
| **Ouvrir l'app** | Double-cliquer sur "Librairie POS" sur le bureau |
| **Redémarrer** | L'app redémarre automatiquement |
| **Accès distant** | Aller sur `https://votre-app.onrender.com` |

---

## Dépannage

| Problème | Solution |
|----------|----------|
| L'app ne s'ouvre pas | `sudo systemctl restart librairie-backend librairie-frontend` |
| Erreur de base de données | `cd /opt/librairie-pos/backend && ./venv/bin/python manage.py migrate` |
| Mettre à jour | Remplacer les fichiers et relancer `sudo systemctl restart librairie-backend` |

---

## Contacts

Pour toute question technique, contacter le développeur.
