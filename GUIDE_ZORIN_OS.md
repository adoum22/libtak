# Installation locale LibTak — Zorin OS 17

Ce mode conserve l’application dans votre dossier personnel et la démarre dans
un terminal. Pour un démarrage automatique au boot, utilisez plutôt
[`deployment/GUIDE_INSTALLATION.md`](deployment/GUIDE_INSTALLATION.md).

## 1. Préparer le dossier

Copiez le projet complet vers un dossier appartenant à votre compte, par
exemple `~/libtak`. Installez au préalable Node.js officiel 20.19+ ou 22.12+.

```bash
cd ~/libtak
node --version
npm --version
chmod 700 install.sh
./install.sh
```

Le script peut installer les paquets système via sudo. S’ils sont déjà
présents, utilisez `./install.sh --skip-system-packages`.

L’installation :

- crée un virtualenv Python et installe les dépendances ;
- crée un fichier privé `backend/.env` sans écraser les valeurs existantes ;
- demande le premier administrateur une seule fois ;
- exécute `npm ci` et construit le frontend ;
- crée puis vérifie une sauvegarde chiffrée initiale.

## 2. Démarrer l’application

```bash
cd ~/libtak
./start_server.sh
```

Gardez ce terminal ouvert. Le script démarre :

- l’API Daphne/ASGI sur `http://127.0.0.1:8000/api/` ;
- le frontend construit sur **http://127.0.0.1:5173** ;
- le contrôle des rapports et de la sauvegarde planifiée toutes les 10 minutes ;
- la synchronisation cloud toutes les 30 minutes lorsqu’elle est configurée.

Utilisez toujours **http://127.0.0.1:5173** pour le POS.

## 3. Synchronisation cloud optionnelle

Ajoutez `CLOUD_API_URL` HTTPS et `SYNC_TOKEN` dans le fichier privé
`backend/.env`, puis redémarrez `start_server.sh`. Aucun secret ne doit être
placé dans ce guide ou dans Git.

## 4. Sauvegardes et journaux

- archives : `~/libtak/.libtak-data/backups/` ;
- rapports : `~/libtak/.libtak-data/logs/reports.log` ;
- synchronisation : `~/libtak/.libtak-data/logs/sync.log`.

Conservez `BACKUP_ENCRYPTION_KEY` dans un coffre séparé. Vérifiez régulièrement
une archive avec `python manage.py verify_backup` depuis le virtualenv.
Pour une seconde copie chiffrée, montez un disque ou partage distinct puis
définissez son chemin absolu dans `BACKUP_OFFSITE_DIR`. Une panne de cette copie
secondaire est journalisée sans supprimer l’archive locale.

Un support rattaché au même PC n'est pas une vraie sauvegarde hors machine.
Pour Backblaze B2 ou un autre stockage S3 compatible, configurez plutôt les
variables `BACKUP_S3_*` dans `backend/.env` en suivant la section
[`Sauvegarde réellement hors machine`](DEPLOY.md#sauvegarde-réellement-hors-machine-s3-compatible).
Utilisez un bucket privé avec Object Lock/rétention et une clé limitée sans
suppression. Les archives en attente restent locales et sont retentées ; LibTak
ne supprime jamais les objets distants. Aucun identifiant S3 ne doit entrer
dans Git.

`BACKUP_MIN_FREE_BYTES=268435456` exige 256 Mio libres dans les espaces
d'archives et temporaire avant une nouvelle archive.
La pré-synchronisation S3 ne purge que les archives expirées confirmées à
distance ; les commandes indiquent le nombre et le volume en octets restant
`pending`.

```bash
cd ~/libtak/backend
./.venv/bin/python manage.py sync_offsite_backups
```

## 5. Dépannage

```bash
cd ~/libtak/backend
./.venv/bin/python manage.py check
```

Si votre installation réutilise `backend/venv`, remplacez `.venv` par `venv`.
Ne supprimez jamais `db.sqlite3`, `.env` ou les archives pour « réinstaller » :
relancez `./install.sh`, qui préserve les données existantes.
