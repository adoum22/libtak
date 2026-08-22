# Installation système — Zorin OS / Ubuntu

Ce parcours installe LibTak depuis le dépôt déjà copié sur le PC, construit le
frontend, initialise Django, vérifie une première sauvegarde chiffrée et crée
les services systemd. L’application finale est accessible uniquement en local
sur **http://127.0.0.1:5173** ; l’API ASGI écoute sur
**http://127.0.0.1:8000/api/**.

## Prérequis

- Zorin OS 17 ou Ubuntu 22.04+ avec `sudo` et systemd ;
- au moins 4 Go de RAM et 10 Go libres ;
- Node.js officiel **20.19+** ou **22.12+**, avec npm ;
- le dossier complet du projet, détenu et modifiable par votre compte normal.

L’installateur ajoute les bibliothèques système Python/PDF avec apt, mais
n’ajoute aucun dépôt Node tiers. Vérifiez Node avant de commencer :

```bash
node --version
npm --version
```

## Installation

Placez de préférence le projet dans votre dossier personnel :

```bash
cd ~/libtak
chmod 700 install.sh deployment/install-zorin.sh
./deployment/install-zorin.sh
```

N’exécutez pas le script avec `sudo`. Il demande ponctuellement sudo pour apt
et pour écrire les unités systemd. Sur une machine dont les paquets système
sont déjà prêts :

```bash
./deployment/install-zorin.sh --skip-system-packages
```

Au premier passage, le script demande une seule fois le nom, l’e-mail optionnel
et la phrase de passe du premier administrateur. La phrase de passe n’est ni
affichée, ni écrite dans `.env`, ni ajoutée à Git.

Le script effectue ensuite :

1. validation Python 3.10+ et Node/Vite ;
2. création/réutilisation du virtualenv backend ;
3. `pip install`, migrations, static files et contrôles Django ;
4. `npm ci` puis build avec l’API locale exacte ;
5. création et vérification d’une archive `.ltbk` chiffrée ;
6. démarrage des services backend et frontend ;
7. contrôle des rapports et de la sauvegarde planifiée toutes les 10 minutes.

## Services et tâches de fond

```bash
systemctl status libtak-backend.service
systemctl status libtak-frontend.service
systemctl status libtak-scheduler.timer
systemctl list-timers 'libtak-*'
```

- `libtak-backend.service` : Daphne/ASGI sur `127.0.0.1:8000` ;
- `libtak-frontend.service` : build Vite sur `127.0.0.1:5173` ;
- `libtak-scheduler.timer` : rapports dus, purge JWT et sauvegarde chiffrée ;
- `libtak-sync.timer` : push cloud toutes les 30 minutes, activé seulement si
  le cloud est configuré lors de l’installation.

Logs :

```bash
journalctl -u libtak-backend -u libtak-frontend -f
journalctl -u libtak-scheduler -u libtak-sync --since today
```

## Secrets et sauvegardes

`backend/.env` est créé avec le mode `600`. Ne le copiez jamais dans Git.
L’archive initiale se trouve sous `.libtak-data/backups/` avec un chiffrement
AES-GCM. Conservez séparément une copie privée de `BACKUP_ENCRYPTION_KEY` : sa
perte rend les archives irrécupérables.

Pour une seconde copie sur un système de fichiers, montez un disque, un partage
réseau ou un volume répliqué distinct et ajoutez son chemin absolu dans
`backend/.env` :

```dotenv
BACKUP_OFFSITE_DIR=/mnt/libtak-offsite
```

La copie est atomique et contrôlée par somme de contrôle. Si le montage est
indisponible, l’échec est journalisé et l’archive locale reste intacte. Testez
régulièrement la restauration d’une archive issue de ce second emplacement.
Un volume situé sur le même PC, notamment un volume Docker nommé, n'est pas une
sauvegarde réellement hors machine.

Pour une destination S3 compatible telle que Backblaze B2, créez un bucket
privé avec Object Lock/rétention côté fournisseur et une clé dédiée limitée au
listing, à la lecture et à l'écriture, sans suppression ni contournement de la
rétention. Ajoutez ensuite les valeurs dans `backend/.env` :

```dotenv
BACKUP_S3_BUCKET=nom-du-bucket-prive
BACKUP_S3_PREFIX=libtak/backups
BACKUP_S3_ENDPOINT_URL=https://endpoint-s3-fourni-par-le-prestataire
BACKUP_S3_REGION=region-fournie-par-le-prestataire
BACKUP_S3_ACCESS_KEY_ID=identifiant-de-cle-limitee
BACKUP_S3_SECRET_ACCESS_KEY=secret-de-cle-limitee
# BACKUP_S3_SESSION_TOKEN=uniquement-pour-des-identifiants-temporaires
```

L'endpoint doit être HTTPS, sans identifiants, nom de bucket ni chemin. Ne
committez jamais ces valeurs. Conservez `BACKUP_ENCRYPTION_KEY` dans un autre
coffre : elle est nécessaire même si les objets S3 restent accessibles. LibTak
relit et vérifie intégralement chaque nouvel objet distant, retente les archives
en attente lors des passages suivants, conserve toute copie locale non
confirmée et ne supprime jamais d'objet distant. La politique de cycle de vie
du bucket gère donc seule la rétention distante. La configuration détaillée est
décrite dans [`DEPLOY.md`](../DEPLOY.md#sauvegarde-réellement-hors-machine-s3-compatible).

Vous pouvez imposer une réserve dans les espaces d'archives et temporaire avant
chaque nouvelle sauvegarde, par exemple 256 Mio :

```dotenv
BACKUP_MIN_FREE_BYTES=268435456
```

Avant la génération, LibTak tente d'abord de synchroniser les archives
existantes et ne purge les archives expirées que si leur copie S3 est confirmée.
Si la réserve reste insuffisante, la nouvelle sauvegarde est refusée sans
supprimer les archives en attente. Les commandes de synchronisation indiquent
le nombre d'archives `pending` et leur volume cumulé en octets.

Vérification manuelle :

```bash
cd ~/libtak/backend
./.venv/bin/python manage.py backup_database
./.venv/bin/python manage.py sync_offsite_backups
./.venv/bin/python manage.py verify_backup /chemin/vers/archive.ltbk
```

Le virtualenv peut aussi s’appeler `venv` lorsqu’une ancienne installation est
réutilisée ; employez alors `./venv/bin/python`.

Une restauration doit être réalisée hors ligne : arrêtez le backend, le
scheduler et la synchronisation avant `manage.py restore_backup ... --confirm
RESTORE`, puis redémarrez-les seulement après le message de succès.

## Synchronisation cloud optionnelle

Ajoutez dans `backend/.env`, sans partager les valeurs :

```dotenv
CLOUD_API_URL=https://votre-backend.example/api
SYNC_TOKEN=secret-aleatoire-long-partage-avec-le-cloud
```

L’URL distante doit être HTTPS. Activez ensuite le timer :

```bash
sudo systemctl enable --now libtak-sync.timer
```

## Mise à jour et dépannage

Après remplacement ou mise à jour contrôlée des fichiers, relancez simplement
le même installateur : il préserve `.env`, la base et les comptes existants,
réinstalle les dépendances verrouillées et reconstruit le frontend.

```bash
./deployment/install-zorin.sh
sudo systemctl restart libtak-backend libtak-frontend
```

L’application s’ouvre sur **http://127.0.0.1:5173**. Ne naviguez pas vers le
port 8000 pour utiliser le POS : ce port est réservé à l’API.
