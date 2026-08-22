# Déploiement Libtak — PythonAnywhere + Vercel

Architecture cible :

- **Backend Django** → PythonAnywhere (`https://votre-compte.pythonanywhere.com`)
- **Frontend React PWA** → Vercel (`https://libtak.vercel.app`)
- **POS local** → SQLite ; `sync_to_cloud.py` pousse les ventes vers PythonAnywhere.

Ne placez jamais de mot de passe, token ou clé réelle dans ce document, un
commit, une commande partagée ou une capture d'écran. Tout secret déjà publié
doit être considéré compromis et remplacé dans le service concerné.

---

## 1. Backend — PythonAnywhere

### 1.1 Créer le compte et cloner le projet

Créez votre compte PythonAnywhere, puis ouvrez une console Bash :

```bash
git clone https://github.com/adoum22/libtak.git
cd libtak
```

### 1.2 Créer le virtualenv

```bash
mkvirtualenv --python=python3.11 libtak
pip install -r backend/requirements-cloud.txt
```

Le plan gratuit n'offre pas Redis. Le management command
`send_scheduled_reports` fournit donc le planificateur de secours, sans worker
Celery ni broker.

### 1.3 Configurer la web app

Dashboard → **Web** → **Add a new web app** :

- choisissez **Manual configuration** → **Python 3.11** ;
- **Source code** : `/home/votre-compte/libtak/backend` ;
- **Working directory** : `/home/votre-compte/libtak/backend` ;
- remplacez le fichier WSGI par
  [`deployment/pythonanywhere_wsgi.py`](./deployment/pythonanywhere_wsgi.py) ;
- **Virtualenv** : `/home/votre-compte/.virtualenvs/libtak` ;
- static `/static/` → `/home/votre-compte/libtak/backend/staticfiles` ;
- media `/media/` → `/home/votre-compte/libtak/backend/media`.

### 1.4 Variables privées

Générez les valeurs sur la machine cible et ne les copiez pas dans Git :

```bash
python -c "import secrets; print(secrets.token_urlsafe(60))"  # SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(60))"  # JWT_SIGNING_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"  # SYNC_TOKEN
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"  # BACKUP_ENCRYPTION_KEY
```

Renseignez-les dans **Web → Environment variables** ou dans
`~/.libtak_env`, fichier privé hors du dépôt et lisible uniquement par votre
compte (`chmod 600 ~/.libtak_env`). La tâche planifiée charge elle aussi ce
fichier.

| Variable | Valeur attendue |
|---|---|
| `DEBUG` | `False` |
| `SECRET_KEY` | valeur aléatoire dédiée d'au moins 50 caractères |
| `JWT_SIGNING_KEY` | autre valeur aléatoire d'au moins 50 caractères |
| `BACKUP_ENCRYPTION_KEY` | base64 URL-safe encodant exactement 32 octets |
| `BACKUP_RETENTION_DAYS` | `30` (à adapter à votre politique) |
| `BACKUP_OFFSITE_DIR` | dossier monté séparément ; vide pour désactiver |
| `ALLOWED_HOSTS` | `votre-compte.pythonanywhere.com` |
| `CORS_ALLOWED_ORIGINS` | URL HTTPS Vercel finale |
| `CSRF_TRUSTED_ORIGINS` | URL HTTPS Vercel finale |
| `DATABASE_URL` | `sqlite:////home/votre-compte/libtak/backend/db.sqlite3` |
| `IS_CLOUD_SERVER` | `True` sur ce backend récepteur PythonAnywhere |
| `EMAIL_HOST` / `EMAIL_PORT` | `smtp.gmail.com` / `587` |
| `EMAIL_HOST_USER` | compte SMTP dédié |
| `EMAIL_HOST_PASSWORD` | mot de passe d'application, jamais le mot de passe principal |
| `DEFAULT_FROM_EMAIL` | expéditeur des rapports |
| `SYNC_TOKEN` | même secret aléatoire sur le cloud et le POS local |

Conservez une copie de récupération de `BACKUP_ENCRYPTION_KEY` dans un coffre
distinct. Sans cette clé, les sauvegardes `.ltbk` sont irrécupérables.
Si `BACKUP_OFFSITE_DIR` est configuré, l'application y copie atomiquement
l'archive déjà chiffrée. Montez ce dossier sur un stockage réellement séparé ;
une indisponibilité hors site n'efface pas la copie locale.

### 1.5 Migrations et premier administrateur

```bash
workon libtak
cd ~/libtak/backend
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

Choisissez un identifiant unique et une phrase de passe longue. Ne documentez
jamais ce mot de passe. Rechargez ensuite la web app et vérifiez
`https://votre-compte.pythonanywhere.com/api/health/`.

### 1.6 Tâches quotidiennes sans Redis

Dans **Tasks → Daily task**, configurez par exemple 23:00 :

```text
workon libtak && cd /home/votre-compte/libtak/backend && python manage.py send_scheduled_reports --daily-slot
```

Cette commande envoie les rapports dus, effectue la sauvegarde chiffrée et
supprime les refresh tokens JWT expirés. Le calendrier conserve ses marqueurs
d'idempotence.

Tests manuels :

```bash
python manage.py send_scheduled_reports --dry-run --daily-slot
python manage.py verify_backup /chemin/vers/une-archive.ltbk
```

Testez périodiquement la restauration sur une copie isolée de l'environnement,
jamais directement sur la base de production.

---

## 2. Frontend — Vercel

1. Importez le dépôt GitHub dans Vercel.
2. Définissez **Root Directory** sur `frontend`.
3. Conservez le preset Vite ; `vercel.json` configure le build, le fallback SPA
   et les en-têtes de sécurité.
4. Ajoutez `VITE_API_URL=https://votre-compte.pythonanywhere.com/api` pour les
   environnements Production et Preview.
5. Déployez.

La CSP de `frontend/vercel.json` autorise l'origine API/WebSocket de production
actuelle. Si le domaine backend change, mettez à jour ses entrées `https://` et
`wss://` dans `connect-src` avant de redéployer.

Une fois l'URL Vercel finale connue, recopiez exactement son origine HTTPS dans
`CORS_ALLOWED_ORIGINS` et `CSRF_TRUSTED_ORIGINS`, puis rechargez Django.

---

## 3. Synchronisation POS local → cloud

Dans le fichier privé `backend/.env` du POS :

```dotenv
CLOUD_API_URL=https://votre-compte.pythonanywhere.com/api
SYNC_TOKEN=valeur-identique-au-secret-du-cloud
```

En production, toute URL cloud non loopback doit utiliser HTTPS. Le HTTP reste
accepté uniquement pour `localhost`, `127.0.0.0/8` et `::1` pendant une
intégration locale.

Sous Windows, créez une tâche toutes les 30 minutes :

- programme : `C:\chemin\vers\libtak\backend\.venv\Scripts\python.exe` ;
- arguments : `sync_to_cloud.py` ;
- démarrer dans : `C:\chemin\vers\libtak\backend`.

---

## 4. Smoke test final

1. `https://votre-compte.pythonanywhere.com/api/health/` répond 200.
2. Le frontend Vercel affiche l'écran de connexion sans erreur CSP.
3. Connectez-vous avec le compte administrateur créé interactivement.
4. Créez une vente de test locale puis lancez `python sync_to_cloud.py`.
5. Vérifiez la vente côté cloud et l'absence de données sensibles dans les logs.
6. Exécutez `python manage.py check --deploy` avec les variables de production.

---

## 5. Coûts indicatifs

| Service | Plan | Prix indicatif |
|---|---|---|
| PythonAnywhere | Beginner | 0 €/mois |
| Vercel | Hobby | 0 €/mois |
| Domaine custom | selon registrar | environ 10 €/an |

Les offres et quotas peuvent changer ; vérifiez les pages tarifaires des
fournisseurs avant le déploiement.
