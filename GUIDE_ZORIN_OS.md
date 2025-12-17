# 📋 Guide d'Installation LibTak - Zorin OS 17.3

## 🎯 Pour le PC de la Librairie

Ce guide vous permet d'installer LibTak sur le PC de la librairie en quelques commandes simples.

---

## 📥 ÉTAPE 1 : Copier l'application

Sur votre PC de développement (Windows), copiez le dossier complet de l'application sur une clé USB.

**Dossier à copier :** `D:\Application Librairie\App`

Sur le PC Zorin OS, copiez ce dossier dans votre répertoire home :
```
/home/[votre-nom]/libtak
```

---

## 🚀 ÉTAPE 2 : Installation (une seule fois)

Ouvrez un **Terminal** (clic droit sur le bureau → "Ouvrir un terminal ici" ou cherchez "Terminal" dans le menu).

Exécutez ces commandes **une par une** :

```bash
# Aller dans le dossier de l'application
cd ~/libtak

# Rendre le script d'installation exécutable
chmod +x install.sh

# Lancer l'installation
./install.sh
```

⏳ Attendez que l'installation se termine (2-5 minutes).

---

## 👤 ÉTAPE 3 : Créer le compte vendeur

Toujours dans le terminal :

```bash
cd ~/libtak/backend
source venv/bin/activate
python3 manage.py createsuperuser
```

Créez le compte :
- **Nom d'utilisateur :** `vendeur`
- **Email :** (appuyez sur Entrée pour passer)
- **Mot de passe :** votre choix

---

## ⏰ ÉTAPE 4 : Configurer la synchronisation automatique (30 min)

```bash
cd ~/libtak
chmod +x setup_auto_sync.sh
./setup_auto_sync.sh
```

✅ Maintenant la synchronisation se fera automatiquement toutes les 30 minutes.

---

## 🖥️ ÉTAPE 5 : Démarrer l'application chaque jour

### Option A : Via le Terminal

```bash
cd ~/libtak
./start_server.sh
```

Gardez ce terminal ouvert toute la journée.

### Option B : Créer un raccourci sur le bureau

1. Clic droit sur le bureau → **Créer un lanceur**
2. Nom : `LibTak`
3. Commande : `/home/[votre-nom]/libtak/start_server.sh`
4. Cochez "Exécuter dans un terminal"
5. Sauvegardez

---

## 🌐 ÉTAPE 6 : Utiliser l'application

1. Ouvrez **Firefox** ou **Chrome**
2. Allez sur : **http://localhost:8000**
3. Connectez-vous avec le compte vendeur

---

## 📝 Résumé des commandes quotidiennes

| Action | Commande |
|--------|----------|
| Démarrer l'application | `cd ~/libtak && ./start_server.sh` |
| Sync manuelle | `cd ~/libtak && ./sync_to_cloud.sh` |
| Voir les logs de sync | `cat ~/libtak/sync.log` |

---

## 🛠️ Dépannage

### Le serveur ne démarre pas
```bash
cd ~/libtak/backend
source venv/bin/activate
python3 manage.py check
```

### Erreur "Permission denied"
```bash
chmod +x ~/libtak/*.sh
```

### Réinstaller complètement
```bash
cd ~/libtak/backend
rm -rf venv db.sqlite3
cd ..
./install.sh
```

---

## 📞 Support

En cas de problème, contactez l'administrateur.

Le serveur cloud est accessible sur : https://libtak.vercel.app
