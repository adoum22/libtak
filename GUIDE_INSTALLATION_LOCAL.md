# 📋 Guide d'Installation - PC Librairie

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│   PC Librairie (LOCAL)              Cloud (PythonAnywhere)      │
│   ──────────────────────            ────────────────────────    │
│   ✅ Fonctionne SANS internet       ✅ Accessible partout       │
│   ✅ Ventes instantanées            ✅ Rapports automatiques    │
│   ✅ Sync toutes les 30 min         ✅ Backup quotidien         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📥 Étape 1: Copier l'application

1. Copiez le dossier `D:\Application Librairie\App` sur le PC de la librairie
2. Assurez-vous que Python est installé (version 3.10+)

---

## 📦 Étape 2: Installer les dépendances

Ouvrez une invite de commandes (cmd) et exécutez:

```cmd
cd "D:\Application Librairie\App\backend"
pip install -r requirements.txt
```

---

## 🗄️ Étape 3: Initialiser la base de données locale

```cmd
cd "D:\Application Librairie\App\backend"
python manage.py migrate
python manage.py createsuperuser
```

Créez un compte admin avec:
- Nom d'utilisateur: `admin`
- Email: `admin@libtak.com`
- Mot de passe: (votre choix)

---

## 📥 Étape 4: Synchroniser les produits depuis le cloud

```cmd
cd "D:\Application Librairie\App\backend"
python sync_to_cloud.py --pull
```

Cela télécharge tous les produits depuis PythonAnywhere.

---

## 🚀 Étape 5: Démarrer le serveur local

**Double-cliquez sur:** `start_local_server.bat`

Ou manuellement:
```cmd
cd "D:\Application Librairie\App\backend"
python manage.py runserver 0.0.0.0:8000
```

Le POS sera accessible sur: **http://localhost:8000**

---

## ⏰ Étape 6: Configurer la synchronisation automatique (30 min)

### Méthode 1: Planificateur de tâches Windows (Recommandé)

1. Ouvrez le **Planificateur de tâches** Windows
   - Recherchez "Planificateur de tâches" dans le menu Démarrer

2. Cliquez sur **"Créer une tâche de base..."**

3. **Nom**: `LibTak Sync`
   **Description**: `Synchronise les ventes vers le cloud`

4. **Déclencheur**: `Quotidiennement`

5. **Action**: `Démarrer un programme`

6. **Programme/script**: 
   ```
   D:\Application Librairie\App\sync_to_cloud.bat
   ```
   **Ajouter des arguments**: `auto`

7. Cochez **"Ouvrir les propriétés..."** → Terminer

8. Dans les propriétés, onglet **Déclencheurs**:
   - Modifiez le déclencheur
   - Cochez **"Répéter la tâche toutes les:"** → `30 minutes`
   - **"Pendant une durée de:"** → `Indéfiniment`

9. Cliquez **OK**

### Méthode 2: Script au démarrage

Ajoutez un raccourci vers `start_local_server.bat` dans:
```
C:\Users\[VotreNom]\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

---

## 🔧 Utilisation quotidienne

### Démarrer le travail:
1. Double-cliquez sur `start_local_server.bat`
2. Ouvrez le navigateur sur `http://localhost:8000`
3. Connectez-vous

### Pendant la journée:
- Faites les ventes normalement
- La synchronisation se fait automatiquement toutes les 30 minutes
- **Pas besoin d'internet** pour les ventes !

### Sync manuelle (si besoin):
Double-cliquez sur `sync_to_cloud.bat`

---

## 🛠️ Dépannage

### Le serveur ne démarre pas
```cmd
cd "D:\Application Librairie\App\backend"
python manage.py check
```

### Erreur de synchronisation
- Vérifiez la connexion internet
- Les ventes seront synchronisées à la prochaine tentative

### Réinitialiser la base locale
```cmd
cd "D:\Application Librairie\App\backend"
del db.sqlite3
python manage.py migrate
python sync_to_cloud.py --pull
```

---

## 📞 Support

En cas de problème, contactez l'administrateur.
