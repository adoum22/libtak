# 🧪 Guide de Test - Bookstore POS

## 📋 Prérequis

Assurez-vous d'avoir installé :
- ✅ Python 3.11+ 
- ✅ Node.js 18+

## 🚀 Étape 1 : Démarrer le Backend

### Option A : Sans Docker (Recommandé pour test rapide)

```bash
# 1. Ouvrir un terminal dans le dossier backend
cd "d:/Application Librairie/App/backend"

# 2. Installer les dépendances Python (si pas déjà fait)
pip install -r requirements.txt

# 3. Appliquer les migrations de base de données
python manage.py migrate

# 4. Créer les utilisateurs de démonstration
python create_users.py

# 5. Charger les produits de démonstration
python seed_products.py

# 6. Démarrer le serveur Django
python manage.py runserver
```

✅ **Le backend est maintenant accessible sur** : http://localhost:8000

### Vérifier que le backend fonctionne

Ouvrez votre navigateur et allez sur :
- 📚 **Documentation API** : http://localhost:8000/api/docs/
- 🔐 **Admin Django** : http://localhost:8000/admin/

---

## 🎨 Étape 2 : Tester l'API Backend

### A. Avec le navigateur (Swagger UI)

1. Allez sur http://localhost:8000/api/docs/
2. Testez l'endpoint de login :
   - Cliquez sur `POST /api/auth/login/`
   - Cliquez sur "Try it out"
   - Entrez :
     ```json
     {
       "username": "admin",
       "password": "admin123"
     }
     ```
   - Cliquez sur "Execute"
   - ✅ Vous devriez recevoir un token JWT

### B. Avec PowerShell (Tests API)

Ouvrez un nouveau terminal PowerShell :

```powershell
# 1. Test de connexion
$body = @{
    username = "admin"
    password = "admin123"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:8000/api/auth/login/" -Method Post -Body $body -ContentType "application/json"
$token = $response.access
Write-Host "Token reçu : $token"

# 2. Récupérer la liste des produits
$headers = @{
    Authorization = "Bearer $token"
}
$products = Invoke-RestMethod -Uri "http://localhost:8000/api/inventory/products/" -Headers $headers
$products | Format-Table

# 3. Rechercher un produit par code-barres
$product = Invoke-RestMethod -Uri "http://localhost:8000/api/inventory/products/?barcode=9780747532743" -Headers $headers
$product

# 4. Créer une vente
$sale = @{
    items = @(
        @{
            product = 1
            quantity = 2
        }
    )
    payment_method = "CASH"
} | ConvertTo-Json

$newSale = Invoke-RestMethod -Uri "http://localhost:8000/api/sales/sales/" -Method Post -Body $sale -Headers $headers -ContentType "application/json"
Write-Host "Vente créée : ID $($newSale.id), Total : $($newSale.total_ttc) €"

# 5. Voir les statistiques
$stats = Invoke-RestMethod -Uri "http://localhost:8000/api/reporting/stats/" -Headers $headers
$stats
```

---

## 🖥️ Étape 3 : Tester le Frontend (Mode Développement)

⚠️ **Note** : Le frontend a des problèmes de build en production, mais fonctionne en mode développement.

```bash
# 1. Ouvrir un NOUVEAU terminal dans le dossier frontend
cd "d:/Application Librairie/App/frontend"

# 2. Installer les dépendances (si pas déjà fait)
npm install

# 3. Démarrer le serveur de développement
npm run dev
```

✅ **Le frontend est maintenant accessible sur** : http://localhost:5173

### Tester le Frontend

1. **Page de Login** (http://localhost:5173/login)
   - Username : `admin`
   - Password : `admin123`
   - Cliquez sur "Login"

2. **Dashboard** (http://localhost:5173/)
   - Vérifiez les statistiques du jour
   - Vérifiez les produits les plus vendus

3. **Interface POS** (http://localhost:5173/pos)
   - Dans le champ de scan, tapez un code-barres : `9780747532743`
   - Appuyez sur Entrée
   - Le produit devrait s'ajouter au panier
   - Ajustez la quantité avec les boutons +/-
   - Cliquez sur "Cash" ou "Card" pour valider la vente

4. **Inventaire** (http://localhost:5173/inventory)
   - Recherchez des produits
   - Vérifiez les niveaux de stock

5. **Test Multilingue**
   - Cliquez sur les boutons FR/EN/AR en haut à droite
   - Vérifiez que l'interface change de langue

---

## 🧪 Scénarios de Test Complets

### Scénario 1 : Vente Simple

1. ✅ Démarrer le backend
2. ✅ Se connecter avec `admin/admin123`
3. ✅ Aller sur l'interface POS
4. ✅ Scanner/taper le code-barres : `9780747532743`
5. ✅ Vérifier que "Livre Harry Potter" apparaît dans le panier
6. ✅ Cliquer sur "Cash"
7. ✅ Vérifier l'alerte de confirmation
8. ✅ Aller sur Dashboard et vérifier que les stats ont changé
9. ✅ Aller sur Inventaire et vérifier que le stock a diminué

### Scénario 2 : Vente Multiple

1. ✅ Scanner plusieurs produits :
   - `9780747532743` (Harry Potter)
   - `3086126700015` (Cahier A4)
   - `3086123001092` (Stylo Bic)
2. ✅ Ajuster les quantités
3. ✅ Vérifier le total
4. ✅ Valider avec "Card"

### Scénario 3 : Alerte Stock Faible

1. ✅ Créer plusieurs ventes du même produit
2. ✅ Aller sur Dashboard
3. ✅ Vérifier la section "Low Stock Items"
4. ✅ Aller sur Inventaire
5. ✅ Vérifier que les produits en stock faible sont en rouge

---

## 🔍 Vérification des Fonctionnalités

### Backend ✅
- [x] Authentification JWT
- [x] Gestion des produits (CRUD)
- [x] Recherche par code-barres
- [x] Création de ventes
- [x] Décrémentation automatique du stock
- [x] Calcul automatique HT/TVA/TTC
- [x] Rapports quotidiens
- [x] Statistiques (top produits, stock faible)
- [x] WebSocket pour temps réel (configuré)

### Frontend ⚠️
- [x] Page de login
- [x] Dashboard avec stats
- [x] Interface POS avec scanner
- [x] Gestion du panier
- [x] Inventaire avec recherche
- [x] Multilingue (FR/EN/AR)
- [x] Navigation protégée
- ⚠️ Build de production (problème de config)

---

## 🐛 Problèmes Connus

### Frontend ne build pas
**Symptôme** : `npm run build` échoue avec erreur PostCSS

**Solution temporaire** : Utiliser `npm run dev` pour le mode développement

**Fix permanent** : Reconfigurer Tailwind/PostCSS (voir README.md)

### Port déjà utilisé
**Symptôme** : "Port 8000 already in use"

**Solution** :
```bash
# Windows PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess | Stop-Process
```

---

## 📊 Données de Test Disponibles

### Utilisateurs
| Username | Password | Rôle |
|----------|----------|------|
| admin | admin123 | Admin |
| cashier | cashier123 | Caissier |

### Produits (Code-barres)
| Produit | Code-barres | Prix TTC |
|---------|-------------|----------|
| Livre Harry Potter | 9780747532743 | ~24€ |
| Livre Le Petit Prince | 9782070408504 | ~10€ |
| Cahier A4 96p | 3086126700015 | ~3€ |
| Stylo Bic Bleu | 3086123001092 | ~0.60€ |
| Gomme Maped | 3154141125008 | ~1.20€ |

---

## ✅ Checklist de Test

- [ ] Backend démarre sans erreur
- [ ] Connexion API réussie
- [ ] Produits visibles dans l'API
- [ ] Frontend démarre en mode dev
- [ ] Login fonctionne
- [ ] Dashboard affiche les stats
- [ ] POS : Scan de code-barres fonctionne
- [ ] POS : Ajout au panier fonctionne
- [ ] POS : Validation de vente fonctionne
- [ ] Stock se décrémente après vente
- [ ] Inventaire affiche les produits
- [ ] Recherche fonctionne
- [ ] Changement de langue fonctionne

---

## 🆘 Besoin d'Aide ?

1. **Backend ne démarre pas** : Vérifiez que Python 3.11+ est installé
2. **Erreur de migration** : Supprimez `db.sqlite3` et relancez `python manage.py migrate`
3. **Frontend ne démarre pas** : Vérifiez que Node.js 18+ est installé
4. **API ne répond pas** : Vérifiez que le backend tourne sur http://localhost:8000

---

**Bon test ! 🚀**
