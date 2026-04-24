# Déploiement Libtak — PythonAnywhere + Vercel

Architecture cible :
- **Backend Django** → PythonAnywhere (`https://dido22.pythonanywhere.com`)
- **Frontend React PWA** → Vercel (`https://libtak.vercel.app`)
- **POS local** (ton PC) → continue à tourner en SQLite, et `sync_to_cloud.py` pousse les ventes vers PythonAnywhere toutes les 30 min.

---

## 1. Backend — PythonAnywhere (gratuit)

### 1.1 Créer le compte
1. Va sur https://www.pythonanywhere.com/registration/register/beginner/ → crée un compte gratuit (username = `dido22` d'après ton code).
2. Ouvre une **Bash console** depuis le dashboard.

### 1.2 Cloner le projet
```bash
git clone https://github.com/adoum22/libtak.git
cd libtak
```

### 1.3 Créer le virtualenv
```bash
mkvirtualenv --python=python3.11 libtak
pip install -r backend/requirements.txt
```
> Le plan gratuit n'a **pas Redis** → Celery Beat ne tournera pas. Les rapports auto seront désactivés (pas grave : tu as toujours les endpoints `/api/reporting/daily/` etc. à appeler manuellement). Si tu veux Celery, passe au plan **Hacker (5 $/mois)**.

### 1.4 Configurer la web app
Dashboard → onglet **Web** → **Add a new web app** :
- Choisis **Manual configuration** → **Python 3.11**
- Une fois créée, va dans la section **Code** :
  - **Source code** : `/home/dido22/libtak/backend`
  - **Working directory** : `/home/dido22/libtak/backend`
  - **WSGI configuration file** : clique sur le lien → remplace tout le contenu par celui de [`deployment/pythonanywhere_wsgi.py`](./deployment/pythonanywhere_wsgi.py)
- Section **Virtualenv** : `/home/dido22/.virtualenvs/libtak`
- Section **Static files** :
  | URL | Directory |
  |---|---|
  | `/static/` | `/home/dido22/libtak/backend/staticfiles` |
  | `/media/` | `/home/dido22/libtak/backend/media` |

### 1.5 Variables d'environnement (Web tab → Environment variables)
| Variable | Valeur |
|---|---|
| `DEBUG` | `False` |
| `SECRET_KEY` | Générer avec `python -c "import secrets;print(secrets.token_urlsafe(60))"` |
| `ALLOWED_HOSTS` | `dido22.pythonanywhere.com` |
| `CORS_ALLOWED_ORIGINS` | `https://libtak.vercel.app` (mets ton vrai domaine Vercel après step 2) |
| `CSRF_TRUSTED_ORIGINS` | `https://libtak.vercel.app` |
| `DATABASE_URL` | `sqlite:////home/dido22/libtak/backend/db.sqlite3` |
| `EMAIL_HOST` | `smtp.gmail.com` |
| `EMAIL_PORT` | `587` |
| `EMAIL_HOST_USER` | ton email Gmail |
| `EMAIL_HOST_PASSWORD` | mot de passe d'application Gmail (pas ton mot de passe normal) |
| `DEFAULT_FROM_EMAIL` | `Libtak <ton@gmail.com>` |
| `SYNC_TOKEN` | un long token aléatoire (sera aussi mis dans `.env` du POS local) |

### 1.6 Migrations + admin
Dans la console Bash :
```bash
workon libtak
cd ~/libtak/backend
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser   # crée DidoEl / Adoum1723 (ou autre)
```

### 1.7 Recharger
Onglet **Web** → bouton vert **Reload** → visite `https://dido22.pythonanywhere.com/api/`.

---

### 1.8 Rapports automatiques par email (sans Celery/Redis)

Le tier gratuit PA n'a pas Redis → Celery Beat ne tourne pas. À la place on utilise la **Scheduled Task** intégrée de PA (1 tâche/jour gratuite) qui appelle une commande Django unique.

1. Va sur le dashboard PA → onglet **Tasks**.
2. Dans **"Daily task"**, choisis l'heure : **23:00**.
3. Dans la case commande, colle exactement (remplace `dido22` si besoin) :
   ```
   workon libtak && cd /home/dido22/libtak/backend && python manage.py send_scheduled_reports
   ```
4. Clique **Create**.

Cette commande :
- Envoie le rapport **quotidien** chaque jour
- Envoie le **hebdomadaire** chaque dimanche
- Envoie le **mensuel** le 28
- Envoie le **trimestriel** le 28 mars/juin/sept/déc
- Envoie l'**annuel** le 31 décembre
- Envoie l'**alerte stock bas** chaque jour
- Fait le **backup DB** chaque jour

**Test manuel** (depuis la console Bash) :
```bash
workon libtak
cd ~/libtak/backend
python manage.py send_scheduled_reports --dry-run     # voir ce qui tournerait aujourd'hui
python manage.py send_scheduled_reports --force-all   # forcer tous les rapports maintenant
```

> ℹ️ Pour que les emails partent vraiment, vérifie que les variables `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` sont bien définies (étape 1.5) et que `email_recipients` est rempli dans **Settings → Rapports** sur le frontend.

---

## 2. Frontend — Vercel (gratuit)

### 2.1 Push du code (déjà fait)
Le code est sur https://github.com/adoum22/libtak.

### 2.2 Importer sur Vercel
1. Connecte-toi sur https://vercel.com avec GitHub.
2. **Add New… → Project** → sélectionne le repo `libtak`.
3. **Root Directory** : clique **Edit** → choisis `frontend`.
4. **Framework Preset** : Vite (auto-détecté).
5. **Build & Output** : laisse les valeurs par défaut (`vercel.json` les écrase au besoin).

### 2.3 Variable d'environnement
Project Settings → **Environment Variables** :
| Name | Value | Environments |
|---|---|---|
| `VITE_API_URL` | `https://dido22.pythonanywhere.com/api` | Production, Preview |

### 2.4 Deploy
Clique **Deploy** → attend ~2 min → tu obtiens une URL `https://libtak-xxxxx.vercel.app`.

> ⚠️ Une fois l'URL Vercel finale connue, **retourne sur PythonAnywhere** et mets cette URL dans `CORS_ALLOWED_ORIGINS` et `CSRF_TRUSTED_ORIGINS`, puis **Reload** la web app.

---

## 3. Sync POS local → cloud

Sur ton PC Windows, le fichier `backend/sync_to_cloud.py` doit pouvoir joindre PythonAnywhere.

### 3.1 Variables d'environnement locales
Dans `backend/.env` (à créer si absent) :
```
SYNC_TOKEN=le-meme-token-que-sur-pythonanywhere
```

### 3.2 Planifier l'exécution toutes les 30 min (Windows)
1. Ouvre **Planificateur de tâches** → **Créer une tâche**.
2. Onglet **Général** : nom = `Libtak Cloud Sync`.
3. Onglet **Déclencheurs** → Nouveau : Quotidien, Répéter la tâche **toutes les 30 minutes** pour une durée de **24 heures**.
4. Onglet **Actions** → Nouveau :
   - Programme : `C:\Users\ADIL\Desktop\libtak\backend\.venv\Scripts\python.exe`
   - Arguments : `sync_to_cloud.py`
   - Démarrer dans : `C:\Users\ADIL\Desktop\libtak\backend`
5. Onglet **Conditions** : décoche "N'exécuter que si l'ordi est sur secteur" si laptop.

### 3.3 Vérifier
Lance la tâche manuellement → ouvre PythonAnywhere → onglet **Files** → `backend/db.sqlite3` doit grossir, et le dashboard cloud doit montrer les nouvelles ventes.

---

## 4. Smoke test final

1. ✅ `https://dido22.pythonanywhere.com/api/` → 200
2. ✅ `https://libtak.vercel.app` → écran de login
3. ✅ Login DidoEl / Adoum1723 → dashboard
4. ✅ Sur ton PC : fais une vente POS local
5. ⏱️ Lance manuellement `python backend/sync_to_cloud.py`
6. ✅ Recharge le dashboard Vercel → la vente apparaît

---

## 5. Coûts récap

| Service | Plan | Prix |
|---|---|---|
| PythonAnywhere | Beginner | **0 €/mois** |
| Vercel | Hobby | **0 €/mois** |
| Domaine custom (optionnel) | OVH .com | ~10 €/an |
| **Total démarrage** | | **0 €** |

Upgrade plus tard si besoin :
- PythonAnywhere Hacker (5 $/mois) → domaine custom + Celery + MySQL
- Vercel Pro (20 $/mois) → seulement si trafic > 100 GB/mois
