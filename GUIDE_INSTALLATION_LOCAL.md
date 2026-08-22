# Installation locale LibTak — Windows

Ce guide complète les installateurs Linux. Le POS Windows final s’ouvre sur
**http://127.0.0.1:5173** ; le port 8000 est réservé à l’API ASGI.

## Prérequis

- Python 3.10+ ;
- Node.js officiel 20.19+ ou 22.12+ avec npm ;
- le dossier complet du projet dans un chemin détenu par votre compte.

## Première installation

Dans PowerShell, depuis la racine du projet :

```powershell
py -3 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --upgrade pip wheel
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
start_local_server.bat
```

Au premier démarrage, le script crée les clés locales privées, applique les
migrations, demande interactivement le premier administrateur si nécessaire,
exécute `npm ci`, construit le frontend et démarre :

- Daphne/ASGI sur `http://127.0.0.1:8000/api/` ;
- le frontend sur **http://127.0.0.1:5173** ;
- les tâches de sauvegarde/rapports et la synchronisation configurée.

Ne documentez ni identifiant, ni mot de passe. Le fichier `backend/.env` ne
doit jamais être envoyé ou ajouté à Git.

## Synchronisation cloud optionnelle

Ajoutez une URL HTTPS et le secret partagé dans `backend/.env` :

```dotenv
CLOUD_API_URL=https://votre-backend.example/api
SYNC_TOKEN=secret-aleatoire-long-partage-avec-le-cloud
```

Redémarrez ensuite `start_local_server.bat`. Pour une exécution au boot et une
sync toutes les 30 minutes, lancez `setup_windows_tasks.bat` en administrateur.

## Sauvegardes

Les tâches de fond créent des archives `.ltbk` chiffrées. Conservez une copie
privée de `BACKUP_ENCRYPTION_KEY` séparément du PC. Un second dossier ou volume
Docker sur ce même PC ne protège pas contre sa perte.

Pour une vraie copie hors machine avec Backblaze B2 ou un autre service S3
compatible, créez un bucket privé avec Object Lock/rétention et une clé dédiée
limitée à la liste, la lecture et l'écriture, sans suppression. Ajoutez les
valeurs uniquement dans `backend\.env` :

```dotenv
BACKUP_S3_BUCKET=nom-du-bucket-prive
BACKUP_S3_PREFIX=libtak/backups
BACKUP_S3_ENDPOINT_URL=https://endpoint-s3-fourni-par-le-prestataire
BACKUP_S3_REGION=region-fournie-par-le-prestataire
BACKUP_S3_ACCESS_KEY_ID=identifiant-de-cle-limitee
BACKUP_S3_SECRET_ACCESS_KEY=secret-de-cle-limitee
# BACKUP_S3_SESSION_TOKEN=uniquement-pour-des-identifiants-temporaires
```

L'endpoint doit être HTTPS, sans identifiants ni chemin. Ne partagez et ne
committez jamais `.env`. Gardez la clé de chiffrement dans un coffre distinct
des identifiants S3. LibTak vérifie chaque nouvel objet distant, retente les
archives en attente et ne supprime aucun objet du bucket ; configurez donc la
rétention distante chez le fournisseur. Voir
[`DEPLOY.md`](DEPLOY.md#sauvegarde-réellement-hors-machine-s3-compatible) pour
la procédure de sécurité complète.

Pour exiger 256 Mio libres dans les espaces d'archives et temporaire avant la
création d'une archive, ajoutez aussi :

```dotenv
BACKUP_MIN_FREE_BYTES=268435456
```

LibTak tente d'abord de synchroniser les archives existantes et ne purge une
archive expirée que si sa copie S3 est confirmée. Si la réserve manque encore,
la sauvegarde est refusée sans supprimer les archives en attente. Les commandes
de synchronisation affichent le nombre d'archives `pending` et leur volume
cumulé en octets.

Vérification manuelle :

```powershell
cd backend
.venv\Scripts\python.exe manage.py backup_database
.venv\Scripts\python.exe manage.py sync_offsite_backups
.venv\Scripts\python.exe manage.py verify_backup C:\chemin\archive.ltbk
```

La première synchronisation relit le contenu distant et compare son SHA-256.
Une archive non confirmée reste locale et sera retentée par la tâche suivante.
Téléchargez périodiquement une archive du bucket vers un dossier isolé, lancez
`verify_backup`, puis testez la restauration sur une base non productive.

Pour restaurer SQLite, arrêtez d'abord toutes les fenêtres LibTak et les tâches
planifiées (serveur et arrière-plan). Aucun processus ne doit garder la base
ouverte pendant `manage.py restore_backup ... --confirm RESTORE`.

## Dépannage sûr

```powershell
backend\.venv\Scripts\python.exe backend\manage.py check
npm.cmd --prefix frontend run build
```

Ne supprimez pas `db.sqlite3`, `.env` ou les archives pour réinstaller. Corrigez
l’erreur signalée, puis relancez `start_local_server.bat`.
