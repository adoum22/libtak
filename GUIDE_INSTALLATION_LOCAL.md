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
privée de `BACKUP_ENCRYPTION_KEY` séparément du PC. Vérification manuelle :

```powershell
cd backend
.venv\Scripts\python.exe manage.py backup_database
.venv\Scripts\python.exe manage.py verify_backup C:\chemin\archive.ltbk
```

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
