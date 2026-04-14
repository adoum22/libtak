# AUDIT DE SÉCURITÉ & QUALITÉ — LIBTAK
**Date :** 11 avril 2026  
**Auditeur :** Claude Sonnet 4.6 (analyse statique complète)  
**Branche :** `claude/ecstatic-agnesi`  
**Portée :** Lecture seule — aucun fichier modifié

---

## 1. RÉSUMÉ EXÉCUTIF

LibTak est un SaaS de gestion de librairie / point de vente (POS) en architecture **API REST + SPA**. Le backend est solide dans son ensemble et suit les conventions Django. Cependant, **plusieurs vulnérabilités critiques doivent être corrigées avant tout déploiement en production**, notamment un endpoint public qui crée des utilisateurs avec des mots de passe connus, un token de synchronisation hardcodé dans le code source, et `DEBUG=True` par défaut.

### Scores par domaine

| Domaine | Note | Commentaire |
|---------|------|-------------|
| Sécurité | **D** | Failles critiques présentes |
| Architecture | **B+** | Clean, bien structurée |
| Qualité de code | **B** | Quelques irrégularités mineures |
| Tests | **C** | Couverture très faible |
| Performance | **B-** | Quelques requêtes N+1 |
| UX/DX | **B** | Bonne doc, UX cohérente |

---

## 2. TABLEAU RÉCAPITULATIF — TOUTES LES ISSUES

| # | Sévérité | Catégorie | Fichier | Description |
|---|----------|-----------|---------|-------------|
| S-01 | 🔴 CRITIQUE | Auth | `core/urls.py:18-67` | Endpoint `init-users` public crée des comptes avec mots de passe connus |
| S-02 | 🔴 CRITIQUE | Config | `config/settings.py:242` | SYNC_TOKEN hardcodé avec valeur par défaut exposée |
| S-03 | 🔴 CRITIQUE | Config | `config/settings.py:11` | `DEBUG=True` par défaut |
| S-04 | 🔴 CRITIQUE | Auth | `core/views.py:78` | `reset_password` utilise `password123` comme fallback silencieux |
| S-05 | 🟠 HAUTE | Auth | `config/settings.py:128` | Blacklist JWT configurée mais module absent des INSTALLED_APPS |
| S-06 | 🟠 HAUTE | Config | `config/settings.py:135` | `CORS_ALLOW_ALL_ORIGINS=True` par défaut (lié à DEBUG) |
| S-07 | 🟠 HAUTE | Frontend | `frontend/src/api/client.ts:8` | URL de production hardcodée dans le source JS |
| S-08 | 🟠 HAUTE | Frontend | `frontend/src/api/client.ts:27` | Token JWT stocké dans `localStorage` (vulnérable XSS) |
| S-09 | 🟠 HAUTE | Upload | `inventory/views.py:108-216` | Import Excel sans limite de taille ni validation MIME |
| S-10 | 🟠 HAUTE | Upload | `core/models.py:21`, `inventory/models.py:15` | Upload d'images sans validation de type ni de taille |
| S-11 | 🟠 HAUTE | Config | `reporting/models.py:21` | Mot de passe SMTP stocké en clair en base de données |
| S-12 | 🟠 HAUTE | Rate Limit | Global | Aucun rate limiting sur les endpoints d'authentification |
| S-13 | 🟡 MOYENNE | Sync | `core/sync_api.py:33,188` | `@permission_classes([AllowAny])` avec vérification manuelle fragile |
| S-14 | 🟡 MOYENNE | Auth | `core/serializers.py:60` | Mot de passe minimum 6 caractères seulement |
| S-15 | 🟡 MOYENNE | Headers | `config/settings.py` | Headers de sécurité manquants (HSTS, CSP, X-Content-Type-Options) |
| S-16 | 🟡 MOYENNE | Cookies | `config/settings.py` | `SESSION_COOKIE_SECURE` et `CSRF_COOKIE_SECURE` non activés |
| S-17 | 🟡 MOYENNE | Logs | Multiple | AuditLog existant mais non utilisé dans la majorité des vues |
| S-18 | 🟡 MOYENNE | Sync | `core/sync_api.py:96` | Déduplication des ventes basée sur `created_at` (non fiable) |
| S-19 | 🟡 MOYENNE | Auth | `config/settings.py:125` | Access token valide 12h (durée trop longue) |
| S-20 | 🟢 BASSE | Auth | `core/urls.py` | Pas de protection brute-force sur `/api/auth/login/` |
| S-21 | 🟢 BASSE | Info | `config/settings.py:10` | SECRET_KEY avec valeur par défaut insécure visible dans le code |
| S-22 | 🟢 BASSE | IDOR | `sales/views.py:13` | Tous les utilisateurs authentifiés voient toutes les ventes |
| Q-01 | 🟡 MOYENNE | Code | `core/sync_api.py:272` | Vérification de rôle inline au lieu d'une permission class |
| Q-02 | 🟡 MOYENNE | Code | `core/views.py:225` | Export limité à 1000 ventes sans le documenter |
| Q-03 | 🟡 MOYENNE | Tests | Multiple | Couverture < 10% — pas de tests pour la sécurité, les permissions |
| Q-04 | 🟡 MOYENNE | DB | `core/views.py:178,225` | N+1 dans l'export Excel (items chargés ligne à ligne) |
| Q-05 | 🟢 BASSE | Code | `reporting/tasks.py` | Tâche `daily_database_backup` planifiée mais non implémentée |
| Q-06 | 🟢 BASSE | DB | `sales/views.py` | Pas de filtre de date sur `SaleViewSet` (liste non paginée possible) |
| Q-07 | 🟢 BASSE | Config | `config/settings.py:177` | `CELERY_BROKER_URL` peut être vide si `REDIS_URL` non défini |
| F-01 | 🟡 MOYENNE | Fonctionnel | — | Pas de gestion multi-boutique (pour SaaS) |
| F-02 | 🟡 MOYENNE | Fonctionnel | — | Pas de gestion de clients / fidélité |
| F-03 | 🟡 MOYENNE | Fonctionnel | — | Pas de gestion de caisse (ouverture/fermeture, float) |
| F-04 | 🟢 BASSE | Fonctionnel | — | Pas de gestion des unités de mesure multi-valeur |
| F-05 | 🟢 BASSE | Fonctionnel | — | Absence de versioning d'API (`/api/v1/`) |
| F-06 | 🟢 BASSE | Fonctionnel | — | Rapports non configurables à la volée (période fixe) |

---

## 3. AUDIT DE SÉCURITÉ — DÉTAIL

### S-01 🔴 CRITIQUE — Endpoint public de création d'utilisateurs

**Fichier :** `backend/core/urls.py` lignes 18–67

**Code fautif :**
```python
@api_view(['GET'])
@permission_classes([AllowAny])   # ← Accessible sans authentification
def init_users(request):
    User.objects.create_superuser(
        username='admin',
        password='admin123',      # ← Mot de passe connu de tous
        ...
    )
    User.objects.create_user(
        username='vendeur',
        password='vendeur123',    # ← Idem
        ...
    )
```

**Impact :** N'importe qui peut appeler `GET /api/auth/init-users/` depuis Internet. Si les utilisateurs `admin`/`vendeur` n'existent pas encore (nouvelle instance), ils sont créés avec des mots de passe triviaux. Même s'ils existent, l'endpoint révèle les noms d'utilisateurs et réinitialise les paramètres de la boutique.

**Correctif :**
```python
# Option 1 : supprimer l'endpoint (utiliser une commande manage.py)
# python manage.py create_default_users

# Option 2 : si l'endpoint doit rester, le restreindre
@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAdminRole])
def init_users(request):
    ...

# Option 3 (recommandé) : commande de gestion
# backend/core/management/commands/create_default_users.py
from django.core.management.base import BaseCommand
import secrets

class Command(BaseCommand):
    def handle(self, *args, **options):
        password = secrets.token_urlsafe(16)
        # créer et afficher le mot de passe une seule fois
```

---

### S-02 🔴 CRITIQUE — Token de synchronisation hardcodé

**Fichier :** `backend/config/settings.py` ligne 242  
**Fichier :** `backend/sync_to_cloud.py`

**Code fautif :**
```python
SYNC_TOKEN = os.environ.get('SYNC_TOKEN', 'libtak-sync-token-2025')
```

**Impact :** Quiconque a accès au dépôt (public ou pas) connaît le token partagé entre le serveur local et le cloud. Cela permet d'envoyer de fausses ventes au serveur cloud ou d'extraire tout le catalogue via `/api/auth/sync/master-data/`.

**Correctif :**
```python
# settings.py
SYNC_TOKEN = os.environ.get('SYNC_TOKEN')
if not SYNC_TOKEN:
    raise ImproperlyConfigured("SYNC_TOKEN must be set in environment variables")
```
Générer un token fort : `python -c "import secrets; print(secrets.token_hex(32))"`

---

### S-03 🔴 CRITIQUE — DEBUG=True par défaut

**Fichier :** `backend/config/settings.py` ligne 11

**Code fautif :**
```python
DEBUG = os.environ.get('DEBUG', 'True') == 'True'
```

**Impact :** En production, si la variable d'environnement `DEBUG` n'est pas explicitement définie, Django affiche les tracebacks complets (avec variables locales, configuration, contenu des requêtes) pour toute erreur 500. Cela expose la structure interne, les chemins de fichiers et potentiellement des secrets.

**Correctif :**
```python
DEBUG = os.environ.get('DEBUG', 'False') == 'True'
```

---

### S-04 🔴 CRITIQUE — Mot de passe par défaut silencieux dans reset_password

**Fichier :** `backend/core/views.py` ligne 78

**Code fautif :**
```python
@action(detail=True, methods=['post'])
def reset_password(self, request, pk=None):
    user = self.get_object()
    new_password = request.data.get('new_password', 'password123')  # ← fallback dangereux
    user.set_password(new_password)
    user.save()
```

**Impact :** Si l'appelant oublie d'envoyer `new_password` dans le body, le mot de passe est silencieusement réinitialisé à `password123`. Un admin distrait peut involontairement créer un compte trivial sans recevoir d'erreur.

**Correctif :**
```python
def reset_password(self, request, pk=None):
    user = self.get_object()
    new_password = request.data.get('new_password')
    if not new_password:
        return Response(
            {'error': 'new_password est requis.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if len(new_password) < 8:
        return Response(
            {'error': 'Le mot de passe doit contenir au moins 8 caractères.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    user.set_password(new_password)
    user.save()
    return Response({'message': f'Mot de passe réinitialisé pour {user.username}'})
```

---

### S-05 🟠 HAUTE — Blacklist JWT configurée mais non fonctionnelle

**Fichier :** `backend/config/settings.py` lignes 124–130

**Code fautif :**
```python
SIMPLE_JWT = {
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,   # ← activé
    ...
}

INSTALLED_APPS = [
    ...
    'rest_framework_simplejwt',
    # 'rest_framework_simplejwt.token_blacklist',  ← ABSENT
    ...
]
```

**Impact :** `BLACKLIST_AFTER_ROTATION = True` n'a aucun effet si le module `token_blacklist` n'est pas dans `INSTALLED_APPS`. Les anciens refresh tokens ne sont pas révoqués après rotation, et un logout ne révoque pas le token. Un attaquant qui vole un refresh token peut l'utiliser indéfiniment pendant 7 jours.

**Correctif :**
```python
INSTALLED_APPS = [
    ...
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',  # Ajouter
    ...
]
# Puis : python manage.py migrate
```

Implémenter aussi un logout actif :
```python
# core/views.py
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError

class LogoutView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        try:
            refresh_token = request.data.get('refresh')
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response({'message': 'Déconnexion réussie.'})
        except TokenError:
            return Response({'error': 'Token invalide.'}, status=400)
```

---

### S-06 🟠 HAUTE — CORS ouvert à tout le monde par défaut

**Fichier :** `backend/config/settings.py` ligne 135

**Code fautif :**
```python
CORS_ALLOW_ALL_ORIGINS = DEBUG  # True par défaut
```

**Impact :** Tout site web peut faire des requêtes authentifiées vers l'API depuis n'importe quelle origine.

**Correctif :**
```python
CORS_ALLOW_ALL_ORIGINS = False  # Toujours False
CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173'
).split(',')
```

---

### S-07 🟠 HAUTE — URL de production hardcodée dans le bundle JS

**Fichier :** `frontend/src/api/client.ts` ligne 8

**Code fautif :**
```typescript
const PRODUCTION_API_URL = 'https://dido22.pythonanywhere.com/api';
```

**Impact :** L'URL de l'infrastructure de production est exposée dans le bundle JavaScript public (visible par tous dans le navigateur). Facilite le ciblage de l'API, le scraping, ou les attaques directes.

**Correctif :**
```typescript
// Utiliser uniquement les variables d'environnement Vite
const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
    throw new Error('VITE_API_URL must be defined');
}
```
Et configurer `VITE_API_URL` dans le CI/CD ou `.env.production` (non committé).

---

### S-08 🟠 HAUTE — Token JWT dans localStorage

**Fichier :** `frontend/src/api/client.ts` ligne 27

**Code fautif :**
```typescript
const token = localStorage.getItem('token');
```

**Impact :** `localStorage` est accessible par tout JavaScript de la page. Si une faille XSS existe (même via une dépendance), l'attaquant peut voler le token et prendre le contrôle du compte.

**Correctif :** Utiliser des cookies HttpOnly (non accessibles au JS) :
```python
# Backend : configurer la réponse JWT pour utiliser des cookies
# avec httpOnly=True, Secure=True, SameSite='Strict'
# Utiliser djangorestframework-simplejwt avec cookie support
```
Ou, au minimum, utiliser `sessionStorage` (limité à l'onglet, effacé à la fermeture).

---

### S-09 🟠 HAUTE — Import Excel sans validation

**Fichier :** `backend/inventory/views.py` lignes 108–216

**Code fautif :**
```python
file = request.FILES['file']
# Aucune vérification de taille, aucune vérification MIME
if file.name.endswith('.csv'):
    df = pd.read_csv(file)
else:
    df = pd.read_excel(file)  # Accepte TOUT fichier non-.csv
```

**Impact :**
- **DoS** : Un fichier Excel de 500 Mo peut saturer la mémoire du serveur.
- **Type confusion** : Un `.xls` renommé en `.xlsx` ou un fichier malformé peut crasher pandas.
- **Formula injection (CSV)** : Des cellules comme `=CMD()` dans un CSV peuvent s'exécuter si le fichier est réouvert dans Excel par un admin.

**Correctif :**
```python
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB

if file.size > MAX_UPLOAD_SIZE:
    return Response({'detail': 'Fichier trop volumineux (max 10 Mo).'}, status=400)

# Vérifier le type MIME réel
import magic
mime = magic.from_buffer(file.read(1024), mime=True)
file.seek(0)
ALLOWED_MIME = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
]
if mime not in ALLOWED_MIME:
    return Response({'detail': 'Type de fichier non autorisé.'}, status=400)
```

---

### S-10 🟠 HAUTE — Upload d'images sans validation

**Fichiers :** `core/models.py:21`, `inventory/models.py:15,87`

**Code fautif :**
```python
avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
image = models.ImageField(upload_to='products/', blank=True, null=True)
```

**Impact :** Django's `ImageField` ne vérifie que partiellement (via Pillow en validation de formulaire Django classique, mais **pas** via DRF `MultiPartParser`). Un fichier SVG contenant du JavaScript, ou un fichier JPEG crafté pour exploiter une vulnérabilité Pillow peut être uploadé.

**Correctif :**
```python
# Dans chaque serializer qui accepte un upload d'image
from PIL import Image
import io

def validate_image(value):
    if value.size > 5 * 1024 * 1024:
        raise serializers.ValidationError("Image trop grande (max 5 Mo).")
    try:
        img = Image.open(value)
        img.verify()  # Vérifie intégrité
    except Exception:
        raise serializers.ValidationError("Fichier image invalide.")
    # Vérifier l'extension
    ext = value.name.rsplit('.', 1)[-1].lower()
    if ext not in ['jpg', 'jpeg', 'png', 'webp']:
        raise serializers.ValidationError("Format non autorisé (jpg, png, webp).")
    return value
```

---

### S-11 🟠 HAUTE — Mot de passe SMTP en clair en base de données

**Fichier :** `backend/reporting/models.py` ligne 21

**Code fautif :**
```python
sender_password = models.CharField(
    _('Sender Password'), max_length=255, blank=True,
    help_text=_('Mot de passe d\'application ou SMTP')
)
```

**Impact :** Le mot de passe de l'email expéditeur est stocké en clair dans la base de données. Tout accès à la DB (dump de backup, faille SQL, accès admin Django) expose ce mot de passe, qui peut être un mot de passe Google ou un token OAuth.

**Correctif :**
Option 1 (simple) : utiliser les variables d'environnement et retirer ce champ du modèle.  
Option 2 (si UI requise) : chiffrer le champ avec `django-encrypted-model-fields` :
```bash
pip install django-encrypted-model-fields
```
```python
from encrypted_model_fields.fields import EncryptedCharField

sender_password = EncryptedCharField(max_length=255, blank=True)
```

---

### S-12 🟠 HAUTE — Absence de rate limiting

**Fichiers :** `core/urls.py`, `config/settings.py`

**Impact :** L'endpoint `/api/auth/login/` peut être soumis à une attaque par force brute sans aucune limitation. 10 000 tentatives par minute sont possibles.

**Correctif :**
```bash
pip install django-ratelimit
# ou : pip install djangorestframework-ratelimit
```
```python
# settings.py
REST_FRAMEWORK = {
    ...
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '20/minute',
        'user': '200/minute',
        'login': '5/minute',  # Custom pour le login
    }
}

# core/views.py
from rest_framework.throttling import AnonRateThrottle

class LoginRateThrottle(AnonRateThrottle):
    rate = '5/minute'

class CustomTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]
```

---

### S-13 🟡 MOYENNE — Permission manuelle sur les endpoints de sync

**Fichier :** `backend/core/sync_api.py` lignes 33, 188

**Code fautif :**
```python
@api_view(['POST'])
@permission_classes([AllowAny])   # Donne une fausse impression de sécurité
def receive_sync_data(request):
    # Vérification manuelle dupliquée
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('SyncToken '):
        return Response({'error': 'Invalid authorization'}, status=401)
    token = auth_header[10:]
    ...
```

**Impact :** La vérification manuelle est correcte fonctionnellement, mais fragile : si quelqu'un ajoute un `return Response(...)` avant la vérification par erreur, l'endpoint devient entièrement public. De plus, `AllowAny` désactive le mécanisme de permission standard de DRF.

**Correctif :**
```python
# Utiliser la classe SyncTokenPermission déjà définie dans le fichier
@api_view(['POST'])
@permission_classes([SyncTokenPermission])  # ← utiliser la classe existante
def receive_sync_data(request):
    # Plus besoin de vérification manuelle
    data = request.data
    ...
```

---

### S-14 🟡 MOYENNE — Longueur minimale des mots de passe

**Fichier :** `backend/core/serializers.py` ligne 60

**Code fautif :**
```python
password = serializers.CharField(write_only=True, min_length=6)
```

**Impact :** Un mot de passe de 6 caractères est insuffisant. Combiné à l'absence de rate limiting, cela facilite les attaques par dictionnaire.

**Correctif :**
```python
password = serializers.CharField(write_only=True, min_length=10)
```
Et activer un validateur de complexité dans `AUTH_PASSWORD_VALIDATORS`.

---

### S-15 🟡 MOYENNE — Headers de sécurité manquants

**Fichier :** `backend/config/settings.py`

Aucun des headers suivants n'est configuré :

| Header | Protection |
|--------|-----------|
| `Strict-Transport-Security` | Force HTTPS |
| `X-Content-Type-Options: nosniff` | Empêche MIME-sniffing |
| `Content-Security-Policy` | Réduit la surface XSS |
| `Permissions-Policy` | Restreint les API navigateur |

**Correctif :**
```python
# settings.py
SECURE_HSTS_SECONDS = 31536000        # 1 an
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True      # Obsolète mais sans risque
X_FRAME_OPTIONS = 'DENY'              # Déjà via middleware, mais être explicite

# Via middleware custom ou django-csp
CONTENT_SECURITY_POLICY = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],  # TailwindCSS
    'img-src': ["'self'", 'data:', 'blob:'],
}
```

---

### S-16 🟡 MOYENNE — Cookies non sécurisés

**Fichier :** `backend/config/settings.py`

Les directives suivantes ne sont pas définies (valeurs par défaut Django = `False`) :
```python
SESSION_COOKIE_SECURE = False   # Cookies session envoyés en HTTP aussi
CSRF_COOKIE_SECURE = False      # CSRF token exposable
```

**Correctif :**
```python
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Strict'
```

---

### S-17 🟡 MOYENNE — AuditLog non utilisé systématiquement

**Fichier :** `backend/core/models.py` — `AuditLog.log()` existe mais n'est appelé dans aucune vue

**Impact :** Il est impossible de savoir qui a fait quoi. Aucune trace de login, de modification de produit, de vente annulée, d'export de données.

**Correctif :** Implémenter un middleware ou des signals :
```python
# core/signals.py
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import AuditLog

@receiver(post_save, sender=Product)
def log_product_save(sender, instance, created, **kwargs):
    action = AuditLog.ActionType.CREATE if created else AuditLog.ActionType.UPDATE
    AuditLog.log(
        user=None,  # récupérer via thread-local ou middleware
        action=action,
        model_name='Product',
        object_id=instance.id,
        object_repr=str(instance),
    )
```

---

### S-18 🟡 MOYENNE — Déduplication de sync fragile

**Fichier :** `backend/core/sync_api.py` lignes 95–99

**Code fautif :**
```python
existing = Sale.objects.filter(
    created_at=sale_data['created_at']  # Collision si 2 ventes à la ms exacte
).first()
```

**Impact :** Si deux ventes locales ont le même timestamp exact (très rare mais possible), l'une est silencieusement ignorée. À l'inverse, un attaquant pourrait rejouer des données avec des timestamps distincts.

**Correctif :** Ajouter un champ `local_id` (UUID) à `Sale` et dédupliquer sur ce champ.

---

### S-19 🟡 MOYENNE — Durée d'access token trop longue

**Fichier :** `backend/config/settings.py` ligne 125

```python
'ACCESS_TOKEN_LIFETIME': timedelta(hours=12),
```

**Impact :** En cas de compromission d'un token (XSS, interception réseau), il reste valide 12 heures. Standard recommandé : 15 minutes avec refresh.

**Correctif :**
```python
'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
```

---

### S-22 🟢 BASSE — IDOR partiel sur les ventes

**Fichier :** `backend/sales/views.py` ligne 14

```python
queryset = Sale.objects.all().order_by('-created_at')
permission_classes = [permissions.IsAuthenticated]
```

**Impact :** Un caissier peut voir les ventes effectuées par d'autres caissiers. Dans le contexte d'une seule boutique, c'est acceptable, mais dans un contexte multi-utilisateurs ou SaaS multi-tenant, c'est un IDOR.

**Correctif (si voulu) :**
```python
def get_queryset(self):
    if self.request.user.is_admin_role:
        return Sale.objects.all().order_by('-created_at')
    return Sale.objects.filter(user=self.request.user).order_by('-created_at')
```

---

## 4. AUDIT FONCTIONNEL — CE QUI MANQUE

### Fonctionnalités présentes
- ✅ POS (Point de vente) avec scan code-barres
- ✅ Gestion des produits, catégories, fournisseurs
- ✅ Gestion du stock (entrées, sorties, inventaire physique)
- ✅ Bons de commande (Purchase Orders)
- ✅ Ventes et retours avec remboursement
- ✅ Codes de réduction / promotions
- ✅ Rapports automatiques par email (journalier, hebdo, mensuel...)
- ✅ Export Excel/backup
- ✅ Sync local ↔ cloud
- ✅ Alertes stock bas
- ✅ Import produits par Excel
- ✅ PWA (Progressive Web App)
- ✅ Interface bilingue (i18n)
- ✅ Historique des prix

### Fonctionnalités manquantes

| # | Fonctionnalité | Priorité | Effort | Valeur métier |
|---|---------------|---------|--------|---------------|
| F-01 | **Gestion de caisse** (ouverture/fermeture, fond de caisse, comptage) | Haute | Moyen | Critique pour comptabilité |
| F-02 | **Gestion clients** (fichier clients, historique achats, fidélité) | Haute | Moyen-Haut | Fidélisation, CRM basique |
| F-03 | **Ticket de caisse imprimable** (PDF ou thermal printer) | Haute | Faible | Légal dans certains pays |
| F-04 | **Tableau de bord temps réel** (WebSocket existant mais sous-utilisé) | Moyenne | Faible | Supervision |
| F-05 | **Versioning d'API** (`/api/v1/`) | Moyenne | Faible | Stabilité clients |
| F-06 | **Multi-boutique / multi-tenant** | Basse | Très haut | SaaS réel |
| F-07 | **Gestion des taxes complexes** (TVA différenciée par produit) | Basse | Moyen | Conformité fiscale |
| F-08 | **Notifications push** (PWA) pour stock bas | Basse | Moyen | UX proactive |
| F-09 | **Import/export comptable** (CSV vers Sage, etc.) | Basse | Moyen | Intégration |
| F-10 | **Backup automatique fonctionnel** (tâche planifiée mais vide) | Haute | Faible | Résilience |

---

## 5. QUALITÉ DU CODE & ARCHITECTURE

### Points forts
- Structure en apps Django bien séparée (`core`, `inventory`, `sales`, `reporting`)
- Usage correct des ViewSets DRF avec serializers distincts (create vs read)
- `select_related` utilisé dans plusieurs QuerySets (`Product.objects.select_related('category', 'supplier')`)
- `AppSettings` et `ReportSettings` en singleton proprement implémentés
- Système de permissions custom bien structuré dans `core/permissions.py`

### Q-01 — Vérification de rôle inline

**Fichier :** `backend/core/sync_api.py` ligne 272

```python
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def trigger_sync(request):
    if not request.user.role == 'ADMIN':   # ← vérification inline
        return Response({'error': 'Admin only'}, status=403)
```

**Correctif :** Utiliser `@permission_classes([IsAuthenticated, IsAdminRole])`.

---

### Q-02 — Export Excel limité à 1000 lignes sans avertissement

**Fichier :** `backend/core/views.py` ligne 225

```python
for sale in Sale.objects.all().order_by('-created_at')[:1000]:
```

La limite de 1000 ventes n'est pas documentée dans la réponse. Un utilisateur avec 5000 ventes pense avoir un backup complet alors qu'il manque 80% des données.

**Correctif :**
```python
total_sales = Sale.objects.count()
sales = Sale.objects.all().order_by('-created_at')[:1000]
# Dans la réponse :
response['X-Total-Sales'] = str(total_sales)
response['X-Exported-Sales'] = '1000'
```
Ou implémenter la pagination dans l'export.

---

### Q-03 — Couverture de tests insuffisante

**Tests présents :**
- `core/tests.py` : 5 tests basiques (login, CRUD user)
- `inventory/tests.py`, `sales/tests.py`, `reporting/tests.py` : présents mais non lus en détail

**Manquants :**
- Tests de permissions (un caissier ne peut pas accéder aux endpoints admin)
- Tests des endpoints de sync (token valide/invalide)
- Tests d'import Excel (fichier malformé, trop grand)
- Tests des calculs financiers (TVA, remises)
- Tests de régression pour les correctifs de sécurité

---

### Q-04 — Requête N+1 dans l'export Excel

**Fichier :** `backend/core/views.py` lignes 225–235

```python
for sale in Sale.objects.all().order_by('-created_at')[:1000]:
    for item in sale.items.all():   # ← requête DB par vente = N+1
```

**Correctif :**
```python
Sale.objects.prefetch_related('items__product').order_by('-created_at')[:1000]
```

---

### Q-05 — Tâche de backup planifiée mais non implémentée

**Fichier :** `backend/config/settings.py` ligne 210

```python
'daily-backup': {
    'task': 'reporting.tasks.daily_database_backup',
    'schedule': crontab(hour=18, minute=0),
},
```

La tâche `daily_database_backup` est référencée dans le scheduler Celery mais n'existe pas dans `reporting/tasks.py`. Celery loguera une erreur silencieuse chaque jour à 18h.

---

### Q-07 — CELERY_BROKER_URL peut être None

**Fichier :** `backend/config/settings.py` lignes 177–178

```python
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', REDIS_URL)
# Si REDIS_URL est '' et CELERY_BROKER_URL non défini → broker = '' → crash au démarrage
```

**Correctif :** Valeur par défaut explicite ou guard :
```python
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL') or REDIS_URL or 'memory://'
```

---

### Migrations

Les migrations sont cohérentes et progressives. Aucune migration destructive détectée.  
**Recommandation :** Ajouter des index sur `Sale.created_at` et `SaleItem.sale` pour les requêtes de rapport.

---

## 6. PERFORMANCE & SCALABILITÉ

### Requêtes potentiellement lentes

| Lieu | Problème | Recommandation |
|------|---------|----------------|
| `core/views.py:178` | `Product.objects.all()` sans limite dans l'export | Ajouter `select_related` + pagination |
| `core/views.py:225` | N+1 ventes/items dans l'export | `prefetch_related('items__product')` |
| `reporting/tasks.py` | `SaleItem.objects.filter(sale__in=sales)` — large IN | Utiliser un range de dates directement |
| `sales/views.py:14` | `Sale.objects.all()` sans filtre de date | Forcer une fenêtre de dates par défaut |
| `inventory/views.py:70` | Pas de limite sur la liste produits pour le POS | Utiliser la pagination existante (PAGE_SIZE=20) |

### Cache

Aucun cache n'est utilisé. Candidates pour le cache :
- `AppSettings.get_settings()` — appelé à chaque requête de settings
- Résultats des rapports quotidiens / statistiques dashboard
- Liste des produits actifs pour le POS (invalidé à chaque changement de stock)

```python
from django.core.cache import cache

@classmethod
def get_settings(cls):
    cached = cache.get('app_settings')
    if cached:
        return cached
    settings, _ = cls.objects.get_or_create(pk=1)
    cache.set('app_settings', settings, 300)  # 5 min
    return settings
```

### Scalabilité

Le projet utilise Celery + Redis + Channels : la base est bonne pour scaler. Points de contention :
- SQLite en dev (ne supporte pas la concurrence), bien géré via `dj_database_url`
- Sync local↔cloud non idempotent → risque de doublons en cas de retry réseau
- Pas de queue de priorité pour les tâches Celery (rapports vs alerts)

---

## 7. UX / DX

### Developer Experience

| Aspect | État |
|--------|------|
| README | ✅ Présent et détaillé |
| Guide de déploiement | ✅ Multiples guides (PythonAnywhere, Railway, Render, Docker, Zorin OS) |
| `.env.example` | ⚠️ Seulement côté frontend, manquant côté backend |
| API Docs | ✅ drf-spectacular (Swagger/OpenAPI auto-généré) |
| Setup local | ✅ Scripts d'installation fournis |
| Tests | ❌ Pas de commande de test documentée dans le README |

**Manquant :** Un fichier `backend/.env.example` avec **toutes** les variables requises documentées.

### Incohérences repérées dans le code

1. **Champs de modèle inconsistants** : `Sale` utilise `total_ttc` mais `core/views.py:229` accède à `sale.total` (champ qui n'existe pas dans le modèle Sale final — peut causer des `AttributeError` à l'export).

2. **`sync_api.py` référence `p.purchase_price_ht` et `p.tva_rate`** (lignes 229-231) mais le modèle `Product` utilise `purchase_price` et `tva` — cela provoquera une `AttributeError` à l'exécution.

3. **Messages d'erreur en français et anglais mélangés** dans les serializers et vues.

4. **`IS_CLOUD_SERVER = True` par défaut** : un serveur local déployé sans cette variable se croira être le cloud et refusera les syncs sortants.

---

## 8. ROADMAP RECOMMANDÉE

### Phase 1 — URGENT (cette semaine, avant tout déploiement)

| Priorité | Action | Fichier(s) |
|----------|--------|-----------|
| 🔴 1 | Supprimer ou sécuriser `init_users` (AllowAny → admin seulement ou commande `manage.py`) | `core/urls.py:18` |
| 🔴 2 | Changer `DEBUG` par défaut à `False` | `config/settings.py:11` |
| 🔴 3 | Rendre `SYNC_TOKEN` obligatoire via variable d'env (pas de fallback) | `config/settings.py:242` |
| 🔴 4 | Corriger `reset_password` (supprimer le fallback `password123`) | `core/views.py:78` |
| 🔴 5 | Ajouter `rest_framework_simplejwt.token_blacklist` dans `INSTALLED_APPS` + migrer | `config/settings.py:21` |
| 🟠 6 | Supprimer l'URL de production hardcodée du frontend | `frontend/src/api/client.ts:8` |
| 🟠 7 | Corriger les champs manquants dans `sync_api.py` (`tva_rate` → `tva`, `purchase_price_ht` → `purchase_price`) | `core/sync_api.py:229` |
| 🟠 8 | Corriger le champ `sale.total` → `sale.total_ttc` dans l'export Excel | `core/views.py:229` |
| 🟠 9 | Créer `backend/.env.example` avec toutes les variables documentées | nouveau fichier |

### Phase 2 — COURT TERME (dans le mois)

| Priorité | Action |
|----------|--------|
| 🟠 1 | Ajouter rate limiting sur `/api/auth/login/` (max 5 req/min par IP) |
| 🟠 2 | Ajouter validation de taille et type sur tous les uploads de fichiers |
| 🟠 3 | Déplacer le mot de passe SMTP hors de la DB (variables d'env ou champ chiffré) |
| 🟠 4 | Configurer les security headers (HSTS, X-Content-Type-Options, CSP) |
| 🟠 5 | Activer `SESSION_COOKIE_SECURE` et `CSRF_COOKIE_SECURE` en production |
| 🟡 6 | Implémenter `daily_database_backup` dans `reporting/tasks.py` |
| 🟡 7 | Ajouter `prefetch_related` dans l'export Excel pour éviter N+1 |
| 🟡 8 | Réduire `ACCESS_TOKEN_LIFETIME` à 15–30 minutes |
| 🟡 9 | Ajouter `CORS_ALLOW_ALL_ORIGINS = False` inconditionnellement |
| 🟡 10 | Écrire des tests pour les permissions (caissier vs admin) et les endpoints sync |

### Phase 3 — MOYEN TERME (dans 3 mois)

| Priorité | Action |
|----------|--------|
| 🟡 1 | Migrer le stockage des tokens vers des cookies HttpOnly (sécurité XSS) |
| 🟡 2 | Intégrer AuditLog dans toutes les vues critiques (via signals ou middleware) |
| 🟡 3 | Implémenter la gestion de caisse (ouverture/fermeture, fond de caisse) |
| 🟡 4 | Ajouter un module clients / fidélité basique |
| 🟡 5 | Implémenter le versioning d'API (`/api/v1/`) |
| 🟢 6 | Ajouter du cache (Redis) sur les settings et les stats du dashboard |
| 🟢 7 | Passer à des UUIDs pour les `local_id` de sync (éviter collisions de timestamp) |
| 🟢 8 | Augmenter la couverture de tests à > 60% (priorité : permissions, calculs, sync) |
| 🟢 9 | Documenter l'API dans Swagger avec exemples de requêtes/réponses |
| 🟢 10 | Audit des dépendances (`pip audit`, `npm audit`) en CI/CD |

---

## ANNEXE — INVENTAIRE DES SECRETS EXPOSÉS

Les éléments suivants sont visibles dans le code source et doivent être **immédiatement rotés** si le dépôt a été accessible :

| Secret | Valeur exposée | Fichier |
|--------|---------------|---------|
| Sync Token | `libtak-sync-token-2025` | `config/settings.py:242` |
| Secret Key | `django-insecure-dev-key-change-in-prod` | `config/settings.py:10` |
| Admin password | `admin123` | `core/urls.py:36` |
| Caissier password | `vendeur123` | `core/urls.py:44` |
| Reset password fallback | `password123` | `core/views.py:78` |
| Production URL | `https://dido22.pythonanywhere.com/api` | `frontend/src/api/client.ts:8` |
| Docker DB password | `bookstore_password` | `docker-compose.yml` |

**Action immédiate :** Changer tous ces mots de passe et tokens dans les environnements de production.

---

*Audit réalisé le 11 avril 2026 — analyse statique complète, aucune modification de code effectuée.*
