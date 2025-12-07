# 🚀 Guide de Déploiement - Librairie Attaquaddoum

## Prérequis

Avant de commencer, vous aurez besoin de :
- Un compte sur [Railway.app](https://railway.app) (gratuit pour commencer)
- Un compte sur [Vercel.com](https://vercel.com) (gratuit)
- Git installé sur votre ordinateur

---

## ÉTAPE 1 : Préparation des fichiers

### 1.1 Ouvrez PowerShell dans le dossier du projet

```powershell
cd "D:\Application Librairie\App"
```

### 1.2 Créez un fichier `.gitignore` à la racine

Créez le fichier `D:\Application Librairie\App\.gitignore` avec ce contenu :

```
# Python
__pycache__/
*.pyc
*.pyo
venv/
.venv/
*.sqlite3
.env

# Node
node_modules/
dist/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

### 1.3 Modifiez le fichier `.env` du frontend

Ouvrez `frontend/.env` et changez :

```
VITE_API_URL=https://VOTRE-BACKEND.railway.app/api
```

*(Vous mettrez l'URL réelle après avoir déployé le backend)*

---

## ÉTAPE 2 : Déployer le Backend sur Railway

### 2.1 Créez un compte Railway

1. Allez sur [railway.app](https://railway.app)
2. Cliquez sur **"Login"** puis **"Login with GitHub"**
3. Créez un compte GitHub si vous n'en avez pas

### 2.2 Créez un nouveau projet

1. Cliquez sur **"New Project"**
2. Choisissez **"Deploy from GitHub repo"**
3. Si c'est votre première fois, autorisez Railway à accéder à votre GitHub

### 2.3 Poussez votre code sur GitHub

Dans PowerShell :

```powershell
# Initialisez Git (si pas déjà fait)
git init

# Ajoutez tous les fichiers
git add .

# Créez le premier commit
git commit -m "Initial commit"

# Créez un nouveau repo sur GitHub puis :
git remote add origin https://github.com/VOTRE-USERNAME/librairie-app.git
git branch -M main
git push -u origin main
```

### 2.4 Configurez Railway

1. Sélectionnez votre repo GitHub
2. Railway détecte automatiquement que c'est un projet Python/Django
3. Cliquez sur **"Deploy"**

### 2.5 Ajoutez une base de données PostgreSQL

1. Dans votre projet Railway, cliquez sur **"+ New"**
2. Choisissez **"Database"** → **"PostgreSQL"**
3. Railway crée automatiquement la base de données

### 2.6 Configurez les variables d'environnement

1. Cliquez sur votre service backend
2. Allez dans l'onglet **"Variables"**
3. Ajoutez ces variables :

```
SECRET_KEY=votre-cle-secrete-longue-et-aleatoire
DEBUG=False
ALLOWED_HOSTS=.railway.app
DATABASE_URL=(automatiquement ajouté par Railway)
```

### 2.7 Créez le fichier Procfile

Créez `backend/Procfile` avec :

```
web: gunicorn config.wsgi --log-file -
release: python manage.py migrate
```

### 2.8 Mettez à jour requirements.txt

Ajoutez ces lignes à `backend/requirements.txt` :

```
gunicorn==21.2.0
dj-database-url==2.1.0
whitenoise==6.6.0
psycopg2-binary==2.9.9
```

### 2.9 Modifiez settings.py pour la production

Dans `backend/config/settings.py`, ajoutez :

```python
import dj_database_url
import os

# En haut du fichier
DEBUG = os.environ.get('DEBUG', 'True') == 'True'
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-key-change-me')

ALLOWED_HOSTS = ['localhost', '127.0.0.1']
if os.environ.get('ALLOWED_HOSTS'):
    ALLOWED_HOSTS.extend(os.environ.get('ALLOWED_HOSTS').split(','))

# Base de données
if os.environ.get('DATABASE_URL'):
    DATABASES = {
        'default': dj_database_url.config(default=os.environ.get('DATABASE_URL'))
    }

# Fichiers statiques
MIDDLEWARE.insert(1, 'whitenoise.middleware.WhiteNoiseMiddleware')
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
STATIC_ROOT = BASE_DIR / 'staticfiles'
```

### 2.10 Poussez les modifications

```powershell
git add .
git commit -m "Production config"
git push
```

Railway redéploie automatiquement ! ✅

### 2.11 Notez l'URL de votre backend

1. Dans Railway, cliquez sur votre service
2. Allez dans **"Settings"** → **"Networking"**
3. Cliquez sur **"Generate Domain"**
4. Copiez l'URL (ex: `librairie-api.railway.app`)

---

## ÉTAPE 3 : Déployer le Frontend sur Vercel

### 3.1 Créez un compte Vercel

1. Allez sur [vercel.com](https://vercel.com)
2. Cliquez sur **"Sign Up"** → **"Continue with GitHub"**

### 3.2 Importez votre projet

1. Cliquez sur **"Add New..."** → **"Project"**
2. Sélectionnez votre repo GitHub
3. Vercel détecte automatiquement Vite

### 3.3 Configurez le projet

1. **Root Directory** : `frontend`
2. **Build Command** : `npm run build`
3. **Output Directory** : `dist`

### 3.4 Ajoutez la variable d'environnement

1. Cliquez sur **"Environment Variables"**
2. Ajoutez :
   - **Name** : `VITE_API_URL`
   - **Value** : `https://VOTRE-BACKEND.railway.app/api`

### 3.5 Déployez

1. Cliquez sur **"Deploy"**
2. Attendez 1-2 minutes
3. Votre site est en ligne ! 🎉

---

## ÉTAPE 4 : Configuration finale

### 4.1 Mettez à jour CORS sur le backend

Dans `backend/config/settings.py`, ajoutez votre domaine Vercel :

```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "https://votre-app.vercel.app",
]
```

### 4.2 Créez un superutilisateur

Dans Railway, allez dans **"Shell"** et exécutez :

```bash
python manage.py createsuperuser
```

Suivez les instructions pour créer admin/password.

---

## ✅ C'est terminé !

Votre application est maintenant en ligne :

| Service | URL |
|---------|-----|
| **Frontend** | `https://votre-app.vercel.app` |
| **Backend** | `https://votre-api.railway.app` |
| **Admin Django** | `https://votre-api.railway.app/admin` |

---

## 🆘 En cas de problème

### Le frontend affiche "Network Error"
→ Vérifiez que `VITE_API_URL` pointe vers le bon backend

### Le backend affiche "500 Error"
→ Vérifiez les logs dans Railway (onglet "Logs")

### Les images ne s'affichent pas
→ Vous aurez besoin de configurer un stockage cloud (Cloudinary, AWS S3)

---

## 💰 Coûts estimés

| Service | Plan Gratuit | Limite |
|---------|--------------|--------|
| Railway | $5/mois crédit offert | ~500h d'exécution |
| Vercel | Gratuit | Illimité pour projets perso |

Pour une utilisation professionnelle, comptez ~$10-20/mois.
