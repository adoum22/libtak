# 🌐 Guide de Configuration PythonAnywhere

Ce guide vous explique comment configurer le serveur cloud (PythonAnywhere) pour recevoir les données synchronisées depuis le PC de la librairie.

---

## 📋 Prérequis

- Un compte PythonAnywhere (gratuit ou payant)
- Le backend LibTak est déployé sur votre propre domaine PythonAnywhere.

---

## 🔧 Étape 1: Configurer les variables d'environnement

Connectez-vous à PythonAnywhere et configurez un secret de synchronisation aléatoire d'au moins 32 caractères dans les variables d'environnement. Transmettez-le au poste local par un canal sûr ; ne le placez jamais dans le dépôt.

```bash
# Valeurs à définir dans l'environnement PythonAnywhere et non dans settings.py
SYNC_TOKEN=<secret-aléatoire-identique-sur-local-et-cloud>
IS_CLOUD_SERVER=True
```

---

## 🔧 Étape 2: Vérifier les URLs

Assurez-vous que le fichier `urls.py` principal inclut les routes de l'API :

```python
# Dans config/urls.py

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('core.urls')),  # ← Contient /api/auth/sync/receive/
    path('api/inventory/', include('inventory.urls')),
    path('api/sales/', include('sales.urls')),
    path('api/reporting/', include('reporting.urls')),
]
```

L'endpoint de synchronisation sera accessible à :
- `https://votre-compte.pythonanywhere.com/api/auth/sync/receive/`

---

## 🔧 Étape 3: Corriger l'URL dans le script local

**IMPORTANT** : Le script local envoie vers `/api/sync/receive/` mais l'URL correcte est `/api/auth/sync/receive/`.

Sur le PC de la librairie, le fichier `/home/librairie/libtak/backend/sync_to_cloud.py` doit avoir :

```python
# Ligne 31
CLOUD_URL = "https://votre-compte.pythonanywhere.com/api/auth"
```

---

## 🔧 Étape 4: Redémarrer l'application sur PythonAnywhere

1. Allez dans l'onglet **"Web"** sur PythonAnywhere
2. Cliquez sur **"Reload"** pour redémarrer l'application

---

## 🔧 Étape 5: Tester la synchronisation

Sur le PC de la librairie, exécutez :

```bash
cd /home/librairie/libtak
./sync_to_cloud.sh
```

Vous devriez voir :
```
✅ Synchronisation réussie!
   - Ventes synchronisées: X
   - Retours synchronisés: X
```

---

## 📱 Accès depuis votre téléphone

Une fois la synchronisation configurée, vous pouvez accéder aux données depuis n'importe où :

1. Ouvrez votre navigateur sur votre téléphone
2. Allez sur `https://votre-compte.pythonanywhere.com`
3. Connectez-vous avec vos identifiants admin
4. Consultez les rapports et les ventes synchronisées

---

## ⚠️ Dépannage

### Erreur 404
L'endpoint n'existe pas sur le serveur cloud. Vérifiez que :
- Le fichier `core/sync_api.py` existe sur PythonAnywhere
- Le fichier `core/urls.py` inclut les routes de sync
- L'application a été rechargée

### Erreur 401 (Unauthorized)
Le token ne correspond pas. Vérifiez que :
- Le `SYNC_TOKEN` est identique dans les deux environnements
- Le token du poste local n'est pas remplacé par une ancienne valeur

### Erreur 500
Problème côté serveur. Consultez les logs sur PythonAnywhere :
- Onglet "Web" → "Error log"

---

## 📊 Vérification

Pour voir les logs de synchronisation sur le PC local :

```bash
tail -50 /home/librairie/libtak/sync.log
```
