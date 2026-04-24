# 🛡️ Pre-Launch Security & Quality Audit — Libtak SaaS

**Audit date:** 2026-04-23
**Scope:** Full backend (Django 5 + DRF + SimpleJWT + Celery + Channels) and full frontend (React 19 + TS + Vite + tanstack-query + recharts) for [Libtak](.) — Librairie Attaquaddoum SaaS.
**Method:** Code review with file:line verification. No runtime testing. No dependency vulnerability scanner.

---

## Executive Summary

The application is feature-complete and largely follows Django/DRF and React idioms, but it **must not go live in its current state**. Five issues are immediately exploitable by anyone who can reach the URL: an unauthenticated `init-users` endpoint that resets `admin / admin123`, those same demo credentials printed on the public login page, a hardcoded fallback `SECRET_KEY`, a hardcoded fallback `SYNC_TOKEN` shared between local and cloud servers, and a `DEBUG=True` default that leaks tracebacks. Two further server-side issues — a broken database backup endpoint that 500s on every call, and a JWT blacklist that silently does nothing because the required Django app isn't installed — make production unsafe even after the auth holes are closed.

Frontend role enforcement is a defense-in-depth gap rather than a true vulnerability (the backend `IsAdminRole` class does enforce server-side), but a CASHIER can URL-hop to `/users`, `/accounting`, `/reports`, etc. and see the page render with empty data, which is confusing UX and a confidentiality concern if any list endpoint is ever loosened. Code quality is acceptable but has duplication around revenue/profit calculations between `reporting/` and the new `accounting/` app, and a few race conditions in stock and discount counters that will surface under multi-cashier load.

**Verdict:** Fixable in **2–4 days of focused work**. Critical issues are listed below with copy-paste fixes. Don't deploy until the Pre-Launch Checklist at the end is fully ticked.

---

## Prioritized Findings Table

| # | Severity | Category | Issue | Location |
|---|---|---|---|---|
| C1 | **Critical** | Auth | `init-users` endpoint open to public, creates `admin / admin123` | [backend/core/urls.py:18-67](backend/core/urls.py) |
| C2 | **Critical** | Auth | Demo credentials displayed on login page | [frontend/src/pages/Login.tsx:127-140](frontend/src/pages/Login.tsx) |
| C3 | **Critical** | Config | `SECRET_KEY` has insecure fallback string | [backend/config/settings.py:10](backend/config/settings.py) |
| C4 | **Critical** | Config | `DEBUG` defaults to `True` | [backend/config/settings.py:11](backend/config/settings.py) |
| C5 | **Critical** | Sync | `SYNC_TOKEN` has hardcoded fallback `libtak-sync-token-2025` | [backend/config/settings.py:242](backend/config/settings.py) |
| C6 | **Critical** | Sync | Sync token compared with `==` (timing attack) | [backend/core/sync_api.py:29, 48, 202](backend/core/sync_api.py) |
| C7 | **Critical** | Sync | `SyncTokenPermission` class defined but unused; sync endpoints use `AllowAny` | [backend/core/sync_api.py:19-30, 33, 189](backend/core/sync_api.py) |
| C8 | **Critical** | Auth | JWT `BLACKLIST_AFTER_ROTATION=True` but `token_blacklist` app not installed → silently no-op | [backend/config/settings.py:128, 21-43](backend/config/settings.py) |
| C9 | **Critical** | Bug | `DatabaseExportView` references non-existent model fields → 500 on every export | [backend/core/views.py:184-235](backend/core/views.py) |
| C10 | **Critical** | Data | `ReportSettings.sender_password` stored plaintext in DB | [backend/reporting/models.py:21](backend/reporting/models.py) |
| C11 | **Critical** | PWA | Service worker caches `/api/*` responses (incl. auth-bearing) for 5 min | [frontend/vite.config.ts:46-57](frontend/vite.config.ts) |
| H1 | High | Auth | No rate limiting / throttling on login endpoint | [backend/config/settings.py:113-121](backend/config/settings.py) |
| H2 | High | Headers | No `SECURE_SSL_REDIRECT` / `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` / HSTS | [backend/config/settings.py](backend/config/settings.py) |
| H3 | High | CORS | `CORS_ALLOW_ALL_ORIGINS = DEBUG` — couples to a setting that defaults `True` | [backend/config/settings.py:135](backend/config/settings.py) |
| H4 | High | Errors | View leaks `str(e)` and `traceback.print_exc()` in 500 responses | [backend/inventory/views.py:218-222](backend/inventory/views.py), [backend/core/sync_api.py:84](backend/core/sync_api.py) |
| H5 | High | Auth | `reset_password` defaults to `'password123'` if body empty | [backend/core/views.py:78](backend/core/views.py) |
| H6 | High | Auth | `UserCreateSerializer.password` `min_length=6`; same for ChangePassword | [backend/core/serializers.py:60, 100](backend/core/serializers.py) |
| H7 | High | Roles | `ProtectedRoute` checks token only — no role gate; CASHIER can URL-hop to admin pages | [frontend/src/App.tsx:19-26](frontend/src/App.tsx) |
| H8 | High | Roles | `isAdmin` derived from `localStorage.getItem('userRole')` (client-trusted) | [frontend/src/components/Layout.tsx:39-41](frontend/src/components/Layout.tsx), [frontend/src/pages/Inventory.tsx:193-195](frontend/src/pages/Inventory.tsx) |
| H9 | High | Race | `Discount.uses_count += 1` not atomic | [backend/sales/views.py:66-76](backend/sales/views.py) |
| H10 | High | Race | `StockMovement.save()` mutates `self.product.stock` non-atomically | [backend/inventory/models.py:204-223](backend/inventory/models.py) |
| H11 | High | Audit | `AuditLog.log()` defined and unused — no audit trail | [backend/core/models.py:109-179](backend/core/models.py) |
| H12 | High | Files | No size/MIME validation on `avatar`, `store_logo`, product images | [backend/core/models.py:20-25](backend/core/models.py), [backend/inventory/models.py](backend/inventory/models.py) |
| H13 | High | Bug | Sync dedup uses `created_at` exact match instead of `local_id` | [backend/core/sync_api.py:95-100, 143-148](backend/core/sync_api.py) |
| M1 | Medium | Code | Revenue & profit logic duplicated between `reporting/` and `accounting/` | [backend/reporting/tasks.py](backend/reporting/tasks.py), [backend/accounting/views.py:21-27](backend/accounting/views.py) |
| M2 | Medium | Perf | `SaleViewSet` lacks `select_related` / `prefetch_related` → N+1 | [backend/sales/views.py](backend/sales/views.py) |
| M3 | Medium | Code | Return state machine doesn't enforce valid transitions | [backend/sales/views.py:102-120](backend/sales/views.py) |
| M4 | Medium | Race | `PurchaseOrder` reference generation read-then-write | [backend/inventory/models.py:322-338](backend/inventory/models.py) |
| M5 | Medium | UX | Many mutations have no `onError` toast → silent failures | frontend/src/pages/*.tsx |
| M6 | Medium | Perf | React-query queries have no `staleTime` → refetch storms | frontend/src/pages/*.tsx |
| M7 | Medium | UX | Layout fetches `/auth/me/` then Inventory fetches it again | [frontend/src/pages/Inventory.tsx:186-190](frontend/src/pages/Inventory.tsx) |
| M8 | Medium | Code | `useMemo` used as side-effect runner in Accounting (anti-pattern) | [frontend/src/pages/Accounting.tsx:130-135](frontend/src/pages/Accounting.tsx) |
| M9 | Medium | Code | `console.log` / `console.error` left in shipped code | frontend/src/pages/Inventory.tsx, POS.tsx, Login.tsx |
| M10 | Medium | Bug | Profit formulas differ between Reports (`revenue - cost`) and Accounting (`revenue - withdrawal - expenses`) — not reconciled in dashboards | [backend/accounting/views.py:71-75](backend/accounting/views.py) |
| L1 | Low | Code | Unused import `JsonResponse` | [backend/core/views.py:127](backend/core/views.py) |
| L2 | Low | Deps | `djangorestframework>=3.14` no upper bound | [backend/requirements.txt:2](backend/requirements.txt) |
| L3 | Low | A11y | `alt=""` on user-uploaded images | frontend/src/pages/Suppliers.tsx, Inventory.tsx |
| L4 | Low | UX | List `.map()` uses array index as key | [frontend/src/pages/Reports.tsx:361](frontend/src/pages/Reports.tsx), Dashboard.tsx, Accounting.tsx |
| L5 | Low | UX | `Settings.tsx` uses `window.location.href = '/users'` instead of `navigate()` | [frontend/src/pages/Settings.tsx:564](frontend/src/pages/Settings.tsx) |
| L6 | Low | Data | `User.phone` `max_length=20` too short for some intl formats | [backend/core/models.py:19](backend/core/models.py) |
| L7 | Low | Validation | `utils/validation.ts` exports schemas that no page imports | [frontend/src/utils/validation.ts](frontend/src/utils/validation.ts) |
| L8 | Low | UX | `ErrorBoundary` calls `localStorage.clear()` on reset → wipes theme/lang prefs | [frontend/src/components/ErrorBoundary.tsx:54](frontend/src/components/ErrorBoundary.tsx) |

---

## Critical Issues — Detailed Fixes

### C1. `init-users` endpoint open to public, creates `admin / admin123`

**File:** [backend/core/urls.py:18-67](backend/core/urls.py)

The `init-users/` URL is decorated `@permission_classes([AllowAny])` and creates an admin user with the static password `admin123` if it doesn't exist. Anyone on the internet can hit this endpoint. If you delete the admin user (intentionally or via migration mistake), the next caller of the URL gets superuser access.

**Fix:** delete the endpoint. Replace it with a Django management command for first-time setup:

```python
# backend/core/management/commands/init_users.py
import os
import secrets
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

class Command(BaseCommand):
    help = "First-time user setup. Refuses to run if any user already exists."

    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.exists():
            self.stderr.write("Users already exist — refusing to run.")
            return
        admin_pwd = os.environ.get('INIT_ADMIN_PASSWORD') or secrets.token_urlsafe(16)
        User.objects.create_superuser(
            username='admin', email='admin@librairie.local',
            password=admin_pwd, role='ADMIN',
        )
        self.stdout.write(self.style.SUCCESS(f"Admin created. Password: {admin_pwd}"))
```

Then in `core/urls.py`, **remove lines 17–67 and 77 entirely**. Run `python manage.py init_users` once on the server.

---

### C2. Demo credentials displayed on login page

**File:** [frontend/src/pages/Login.tsx:127-140](frontend/src/pages/Login.tsx)

```tsx
<p className="mt-1 font-mono">admin / admin123</p>
<p className="mt-1 font-mono">vendeur / vendeur123</p>
```

Anyone who loads the login page sees the credentials. Combined with C1, this is account takeover.

**Fix:** Delete the entire "Demo Credentials" block (lines 127–140 of `Login.tsx`).

---

### C3. `SECRET_KEY` has insecure fallback

**File:** [backend/config/settings.py:10](backend/config/settings.py)

```python
SECRET_KEY = os.environ.get('SECRET_KEY', 'django-insecure-dev-key-change-in-prod')
```

If the env var is unset on the production server, Django boots with a globally known key. Sessions, password reset tokens, and signed cookies are all forgeable.

**Fix:**

```python
SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY environment variable is required")
```

---

### C4. `DEBUG` defaults to `True`

**File:** [backend/config/settings.py:11](backend/config/settings.py)

```python
DEBUG = os.environ.get('DEBUG', 'True') == 'True'
```

Production traceback pages leak source code, settings, and SQL queries.

**Fix:**

```python
DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 'yes')
```

---

### C5. `SYNC_TOKEN` has hardcoded fallback

**File:** [backend/config/settings.py:242](backend/config/settings.py)

```python
SYNC_TOKEN = os.environ.get('SYNC_TOKEN', 'libtak-sync-token-2025')
```

If env var missing on either side, sync auth uses the literal string above — published in this repo. Anyone can push fake sales or pull master data.

**Fix:**

```python
SYNC_TOKEN = os.environ.get('SYNC_TOKEN')
if not SYNC_TOKEN and not DEBUG:
    raise RuntimeError("SYNC_TOKEN environment variable is required in production")
```

Generate a new token (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) and rotate on **both** local and cloud `.env`.

---

### C6 & C7. Sync token uses `==` and `AllowAny` instead of the defined permission class

**File:** [backend/core/sync_api.py:19-30, 33, 48, 188-203](backend/core/sync_api.py)

A `SyncTokenPermission` class is defined (lines 19–30) but **never used**. Both sync endpoints use `@permission_classes([AllowAny])` and re-implement token checking with plain `==`, which is vulnerable to timing-based token recovery.

**Fix:** Make the permission class proper DRF, harden the comparison, and apply it:

```python
# backend/core/sync_api.py — replace lines 19-30
from rest_framework.permissions import BasePermission
from django.utils.crypto import constant_time_compare

class SyncTokenPermission(BasePermission):
    def has_permission(self, request, view):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('SyncToken '):
            return False
        token = auth[len('SyncToken '):]
        expected = getattr(settings, 'SYNC_TOKEN', None)
        if not expected:
            return False
        return constant_time_compare(token, expected)
```

Then change both decorators:

```python
# line 33-34
@api_view(['POST'])
@permission_classes([SyncTokenPermission])
def receive_sync_data(request):
    # delete the manual token check (lines 41-49) — permission class handles it
    data = request.data
    ...

# line 188-189
@api_view(['GET'])
@permission_classes([SyncTokenPermission])
def get_master_data(request):
    # delete the manual token check (lines 195-203)
    since = request.query_params.get('since')
    ...
```

---

### C8. JWT blacklist is silently disabled

**Files:** [backend/config/settings.py:21-43](backend/config/settings.py), [backend/config/settings.py:124-130](backend/config/settings.py)

`SIMPLE_JWT` has `'BLACKLIST_AFTER_ROTATION': True` but `rest_framework_simplejwt.token_blacklist` is **not** in `INSTALLED_APPS`. The setting is a no-op. Logged-out users keep valid refresh tokens; rotated tokens are not invalidated.

**Fix:**

```python
# settings.py — add to INSTALLED_APPS
INSTALLED_APPS = _OPTIONAL_APPS + [
    ...
    'rest_framework_simplejwt.token_blacklist',
    'core',
    ...
]
```

Run `python manage.py migrate token_blacklist`. Then add a logout endpoint:

```python
# backend/core/views.py
from rest_framework_simplejwt.tokens import RefreshToken

class LogoutView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        try:
            RefreshToken(request.data['refresh']).blacklist()
        except Exception:
            pass
        return Response(status=205)

# backend/core/urls.py — add to urlpatterns
path('logout/', LogoutView.as_view(), name='logout'),
```

Update `frontend/src/components/Layout.tsx` `handleLogout` to POST `/auth/logout/` with the refresh token before clearing localStorage.

---

### C9. `DatabaseExportView` references non-existent model fields

**File:** [backend/core/views.py:184-235](backend/core/views.py)

The Excel backup endpoint uses field names that don't exist on the actual models. This view 500s the moment Admin clicks "Backup":

| Code | Actual model field |
|---|---|
| `prod.purchase_price` (line 184) | `purchase_price_ht` |
| `prod.sale_price` (line 185) | `sale_price_ht` |
| `prod.tva` (line 186) | `tva_rate` |
| `prod.unit` (line 189) | (doesn't exist) |
| `prod.is_active` (line 190) | `active` |
| `sale.total` (line 229) | `total_ttc` |
| `sale.cashier` (line 231) | `user` |
| `item.unit_price` (line 234) | `unit_price_ht` |
| `item.total` (line 235) | `total_price_ht` |

**Fix:** Replace lines 178–236 by reading the real field names off [backend/inventory/models.py](backend/inventory/models.py) and [backend/sales/models.py](backend/sales/models.py). Example for the products block:

```python
ws.cell(row=row, column=6, value=float(prod.purchase_price_ht))
ws.cell(row=row, column=7, value=float(prod.sale_price_ht))
ws.cell(row=row, column=8, value=float(prod.tva_rate))
ws.cell(row=row, column=9, value=prod.stock)
ws.cell(row=row, column=10, value=prod.min_stock)
# remove column 11 (unit) entirely, drop "Unité" from `headers`
ws.cell(row=row, column=11, value='Oui' if prod.active else 'Non')
```

And the sales loop:

```python
ws.cell(row=row, column=3, value=float(sale.total_ttc))
ws.cell(row=row, column=4, value=sale.payment_method)
ws.cell(row=row, column=5, value=sale.user.username if sale.user else '')
ws.cell(row=row, column=8, value=float(item.unit_price_ht))
ws.cell(row=row, column=9, value=float(item.total_price_ht))
```

Add a smoke test (`backend/core/tests.py`) that calls the endpoint and asserts 200.

---

### C10. SMTP password stored plaintext in DB

**File:** [backend/reporting/models.py:21](backend/reporting/models.py)

`sender_password = models.CharField(max_length=255, ...)` stores the SMTP password unencrypted. Anyone with DB access (or a `db.sqlite3` leak — file is currently in `backend/`) gets the email credentials.

**Fix (preferred):** stop storing it in the DB. Use the env-var SMTP credentials already configured in [settings.py:227-228](backend/config/settings.py) (`EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`). Remove `sender_email`, `sender_password`, `smtp_host`, `smtp_port` from `ReportSettings` and from any code that reads them.

**Fix (if you must keep per-tenant SMTP):** install `django-cryptography`, store with `encrypt(models.CharField(...))`, and ensure the serializer always has `'sender_password': {'write_only': True}` (already true at [reporting/serializers.py:22](backend/reporting/serializers.py)).

Also: **add `db.sqlite3` to `.gitignore`** if it isn't already, and rotate any SMTP password that was ever committed.

---

### C11. PWA caches authenticated API responses

**File:** [frontend/vite.config.ts:46-57](frontend/vite.config.ts)

```js
{ urlPattern: /\/api\/.*/i, handler: 'NetworkFirst', options: { cacheName: 'api-cache', expiration: { maxAgeSeconds: 60 * 5 } } }
```

If two users share a device (Admin laptop, then Cashier opens the PWA offline), the Cashier may receive Admin-authorized cached responses for up to 5 minutes. Worse, the cache survives logout.

**Fix:** remove the `/api/.*` rule entirely or restrict to public endpoints only:

```js
runtimeCaching: [
    // ... google-fonts rules ...
    // delete the /api/.* rule
]
```

If you want offline support for genuinely public data (e.g., `/api/auth/settings/public/`), add a narrow rule for that exact URL. Also clear caches on logout in `Layout.tsx`:

```ts
const handleLogout = async () => {
    if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
    }
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    navigate('/login');
};
```

---

## High Issues — Detailed Fixes

### H1. No throttling on login

**File:** [backend/config/settings.py:113-121](backend/config/settings.py)

Add to `REST_FRAMEWORK`:

```python
'DEFAULT_THROTTLE_CLASSES': [
    'rest_framework.throttling.ScopedRateThrottle',
    'rest_framework.throttling.UserRateThrottle',
],
'DEFAULT_THROTTLE_RATES': {
    'login': '10/min',
    'user': '1000/hour',
    'anon': '100/hour',
},
```

Then in `core/views.py`:

```python
class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
    throttle_scope = 'login'
```

### H2. Missing security headers

**File:** [backend/config/settings.py](backend/config/settings.py) — add at the bottom:

```python
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_REFERRER_POLICY = 'same-origin'
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
```

### H3. CORS coupled to `DEBUG`

**File:** [backend/config/settings.py:135](backend/config/settings.py)

Replace `CORS_ALLOW_ALL_ORIGINS = DEBUG` with an explicit dev-origins list. After fixing C4, this is less dangerous, but defense-in-depth says don't couple them:

```python
CORS_ALLOW_ALL_ORIGINS = False
# CORS_ALLOWED_ORIGINS already populated from env above
```

### H4. Stack traces and exception messages leaked

**Files:** [backend/inventory/views.py:218-222](backend/inventory/views.py), [backend/core/sync_api.py:84](backend/core/sync_api.py), [backend/reporting/views.py:195-198](backend/reporting/views.py)

Pattern to replace everywhere:

```python
import logging
logger = logging.getLogger(__name__)
...
except Exception:
    logger.exception("Operation failed")  # full traceback to log, not response
    return Response({'detail': 'Une erreur est survenue.'}, status=500)
```

Remove every `traceback.print_exc()` and `str(e)` from Response bodies.

### H5. `reset_password` defaults to `'password123'`

**File:** [backend/core/views.py:75-83](backend/core/views.py)

```python
@action(detail=True, methods=['post'])
def reset_password(self, request, pk=None):
    user = self.get_object()
    new_password = request.data.get('new_password')
    if not new_password or len(new_password) < 12:
        return Response(
            {'detail': 'Mot de passe d\'au moins 12 caractères requis.'},
            status=400
        )
    user.set_password(new_password)
    user.save()
    return Response({'message': f'Mot de passe réinitialisé pour {user.username}'})
```

### H6. Password min length 6

**File:** [backend/core/serializers.py:60, 100](backend/core/serializers.py) and [backend/config/settings.py:89-94](backend/config/settings.py)

Change `min_length=6` to `min_length=12` in both serializers, and in settings:

```python
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
```

### H7. `ProtectedRoute` doesn't gate by role

**File:** [frontend/src/App.tsx:19-26](frontend/src/App.tsx)

Add a role-aware wrapper and use it on every admin route. Source of truth must be the **`/auth/me/` response**, not localStorage:

```tsx
import { useQuery } from '@tanstack/react-query';
import client from './api/client';

function AdminRoute({ children }: { children: React.ReactNode }) {
    const token = localStorage.getItem('token');
    const { data, isLoading, isError } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => client.get('/auth/me/').then(r => r.data),
        enabled: !!token,
        retry: false,
    });
    if (!token) return <Navigate to="/login" replace />;
    if (isLoading) return <div className="p-8 text-center text-muted">…</div>;
    if (isError || data?.role !== 'ADMIN') return <Navigate to="/" replace />;
    return <>{children}</>;
}
```

Wrap every admin route:

```tsx
<Route path="users" element={<AdminRoute><Users /></AdminRoute>} />
<Route path="settings" element={<AdminRoute><Settings /></AdminRoute>} />
<Route path="reports" element={<AdminRoute><Reports /></AdminRoute>} />
<Route path="suppliers" element={<AdminRoute><Suppliers /></AdminRoute>} />
<Route path="purchase-orders" element={<AdminRoute><PurchaseOrders /></AdminRoute>} />
<Route path="returns" element={<AdminRoute><Returns /></AdminRoute>} />
<Route path="stock-count" element={<AdminRoute><StockCount /></AdminRoute>} />
<Route path="zakat" element={<AdminRoute><Zakat /></AdminRoute>} />
<Route path="accounting" element={<AdminRoute><Accounting /></AdminRoute>} />
```

### H8. `userRole` from localStorage trusted

**Files:** [frontend/src/components/Layout.tsx:39-41](frontend/src/components/Layout.tsx), [frontend/src/pages/Inventory.tsx:193-195](frontend/src/pages/Inventory.tsx) and others

After H7, derive `isAdmin` from the same `currentUser` query:

```tsx
const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => client.get('/auth/me/').then(r => r.data),
});
const isAdmin = currentUser?.role === 'ADMIN';
```

Stop writing `userRole` to localStorage in `Login.tsx` (or keep it but **never read it** for security decisions — only for UI hints before the `/me/` call resolves).

### H9. `Discount.uses_count` race

**File:** [backend/sales/views.py:66-76](backend/sales/views.py)

Replace `discount.uses_count += 1; discount.save()` with an atomic update:

```python
from django.db.models import F
Discount.objects.filter(pk=discount.pk).update(uses_count=F('uses_count') + 1)
```

### H10. `StockMovement` mutates product non-atomically

**File:** [backend/inventory/models.py:204-223](backend/inventory/models.py)

Wrap in a transaction and use `select_for_update` so concurrent stock-ins don't lose updates:

```python
from django.db import transaction

def save(self, *args, **kwargs):
    with transaction.atomic():
        super().save(*args, **kwargs)
        product = Product.objects.select_for_update().get(pk=self.product_id)
        if self.movement_type == 'IN':
            product.stock = F('stock') + self.quantity
        elif self.movement_type == 'OUT':
            product.stock = F('stock') - self.quantity
        else:
            product.stock = self.quantity  # ADJUST
        product.save(update_fields=['stock'])
```

### H11. Audit log unused

**File:** [backend/core/models.py:109-179](backend/core/models.py)

Call `AuditLog.log()` from at minimum: user create/update/delete, role/permission changes, login (in `CustomTokenObtainPairSerializer`), discount apply, sale create, return approve/reject, stock adjustments. Pattern:

```python
AuditLog.log(
    user=request.user, action=AuditLog.ActionType.CREATE,
    model_name='User', object_id=instance.id,
    object_repr=str(instance), request=request,
)
```

### H12. File upload validation

**File:** [backend/core/models.py:20-25](backend/core/models.py) and Product/Supplier images.

Add to `core/serializers.py` (and similar in inventory serializers):

```python
def validate_avatar(self, value):
    if value and value.size > 2 * 1024 * 1024:
        raise serializers.ValidationError('Image > 2 Mo non autorisée.')
    if value and not value.content_type.startswith('image/'):
        raise serializers.ValidationError('Fichier non-image refusé.')
    return value
```

Or use `FileExtensionValidator(['jpg', 'jpeg', 'png', 'webp'])` directly on the model field.

### H13. Sync deduplication

**File:** [backend/core/sync_api.py:95-100, 143-148](backend/core/sync_api.py)

Add `local_sync_id = models.CharField(max_length=64, unique=True, null=True, blank=True)` to `Sale` and `Return` (with migration), set it to `sale_data['local_id']` on import, and dedupe by that field instead of `created_at`.

---

## Medium Issues — Brief Fixes

| # | Fix |
|---|---|
| **M1** Duplicate revenue logic | Extract `_revenue_for(year, month)` from [accounting/views.py:21-27](backend/accounting/views.py) into a shared helper (e.g., `sales/aggregates.py`) and import from both `reporting/` and `accounting/`. |
| **M2** N+1 on sales list | In `SaleViewSet.get_queryset()`: `return qs.select_related('user').prefetch_related('items__product')`. |
| **M3** Return state machine | Add a class-level `ALLOWED_TRANSITIONS` dict in the Return viewset; raise `ValidationError` if `current → target` not allowed. |
| **M4** PurchaseOrder ref race | Switch to `default=uuid.uuid4` and rely on the unique constraint instead of pre-checking. |
| **M5** Silent mutation failures | For every `useMutation` in `frontend/src/pages/`, add `onError: (e: any) => toast.error(e.response?.data?.detail || 'Erreur')`. Audit POS, Users, Suppliers, Returns, PurchaseOrders, StockCount, Settings. |
| **M6** Refetch storms | Add `staleTime: 60_000` (or higher) to all `useQuery` calls except dashboard counters. Consider a top-level `QueryClient` default. |
| **M7** Duplicate `/auth/me/` calls | Move the `currentUser` query into a `UserContext` provider in `App.tsx`, consume via hook in Layout, Inventory, etc. |
| **M8** `useMemo` as effect | In [Accounting.tsx:130-135](frontend/src/pages/Accounting.tsx) replace `useMemo` with `useEffect`. |
| **M9** Console logs in prod | Remove or wrap with `if (import.meta.env.DEV)`. Add ESLint rule `no-console: ['warn', { allow: ['warn', 'error'] }]`. |
| **M10** Profit formula divergence | Document which view is authoritative. The cleanest move: drop the cost-of-goods profit from Reports if you're now computing net via Accounting (revenue − withdrawal − expenses). |

---

## Low Issues — Brief Fixes

| # | Fix |
|---|---|
| **L1** Unused `JsonResponse` import | Delete the import on [core/views.py:127](backend/core/views.py). |
| **L2** Loose dep pins | `djangorestframework>=3.14,<4.0` (and similar for Pillow, weasyprint). |
| **L3** Empty `alt` attrs | Provide meaningful `alt={\`Logo de ${supplier.name}\`}` etc. |
| **L4** Index keys in lists | Use `key={item.id}` or `key={item.barcode}` in `Reports.tsx:361`, `Dashboard.tsx:160`, `Accounting.tsx:353`. |
| **L5** `window.location.href` in Settings | `import { useNavigate } from 'react-router-dom'` and use `navigate('/users')`. |
| **L6** Phone length | Change `User.phone` to `max_length=30`. |
| **L7** Unused validation utils | Either delete `frontend/src/utils/validation.ts` and `hooks/useFormValidation.ts`, or wire them into Login/Users/Suppliers/Inventory create-modals. |
| **L8** ErrorBoundary clear-all | Replace `localStorage.clear()` with `localStorage.removeItem('token'); localStorage.removeItem('userRole');`. |

---

## Pre-Launch Checklist

Tick every box before pointing the production DNS. **Order matters** — auth holes first.

### Block deploy if any of these is unchecked

- [ ] **C1** `init-users/` URL deleted from `core/urls.py`; replaced by management command
- [ ] **C2** Demo credentials block removed from `Login.tsx`
- [ ] **C3** `SECRET_KEY` raises if env var missing; new value generated for prod
- [ ] **C4** `DEBUG` defaults to `False`
- [ ] **C5** `SYNC_TOKEN` raises if env missing; **new value rotated on local AND cloud**
- [ ] **C6/C7** `SyncTokenPermission` is a DRF `BasePermission` using `constant_time_compare`; both sync endpoints use it (not `AllowAny`)
- [ ] **C8** `rest_framework_simplejwt.token_blacklist` in `INSTALLED_APPS`; migration applied; logout endpoint live; frontend logs out via API
- [ ] **C9** `DatabaseExportView` field names match models; manual smoke test of `/api/auth/backup/` returns a valid `.xlsx`
- [ ] **C10** SMTP password no longer in `ReportSettings` (or encrypted); `db.sqlite3` in `.gitignore`; any leaked password rotated
- [ ] **C11** `vite.config.ts` no longer caches `/api/*`; logout clears `caches`

### Production env vars set

- [ ] `SECRET_KEY=<48+ chars random>`
- [ ] `DEBUG=False`
- [ ] `ALLOWED_HOSTS=<your real domains, comma-separated>`
- [ ] `CORS_ALLOWED_ORIGINS=<your real frontend domains>`
- [ ] `SYNC_TOKEN=<48+ chars random, same on local + cloud>`
- [ ] `EMAIL_HOST_PASSWORD=<set, never committed>`
- [ ] `DATABASE_URL=<postgres://...>` — **do not ship SQLite to prod**
- [ ] `INIT_ADMIN_PASSWORD=<one-time strong pwd>`

### Hardening

- [ ] **H1** Login throttling configured (10/min); verified by curl loop
- [ ] **H2** All `SECURE_*` headers set when `DEBUG=False`
- [ ] **H3** `CORS_ALLOW_ALL_ORIGINS = False`
- [ ] **H4** No `traceback.print_exc()` in any view; no `str(e)` in Response bodies
- [ ] **H5** `reset_password` requires explicit ≥12-char password
- [ ] **H6** Password validators raised to `min_length=12` everywhere
- [ ] **H7** `AdminRoute` wraps every admin-only route in `App.tsx`
- [ ] **H8** `isAdmin` no longer derived from `localStorage` for security decisions
- [ ] **H9/H10** Atomic updates for `Discount.uses_count` and `StockMovement` → `Product.stock`
- [ ] **H11** `AuditLog.log()` called from at least: login, user CRUD, sale create, return state-change, stock adjust
- [ ] **H12** File-upload size + MIME validation on avatar, store_logo, product/supplier images
- [ ] **H13** Sync dedup uses `local_sync_id`, not `created_at`

### Operational

- [ ] First admin user seeded via `python manage.py init_users` (not the deleted endpoint)
- [ ] All Cashier users have `can_view_stock` / `can_manage_stock` reviewed
- [ ] `python manage.py check --deploy` returns clean
- [ ] `python manage.py test` green (run accounting tests too)
- [ ] `npm run build` produces no TS or lint errors
- [ ] Backup endpoint manually tested and downloads a valid Excel file
- [ ] Login → Cashier role → manual URL hop to `/users`, `/accounting`, `/reports` → all redirect to `/` (verifies H7)
- [ ] Logout → confirm refresh token rejected by `/api/auth/refresh/` (verifies C8)
- [ ] Sync once between local and cloud, verify rows appear (verifies C6/C7/H13)
- [ ] Celery beat & worker confirmed running and tasks discovered (autodiscover_tasks)
- [ ] Static files served via WhiteNoise; media files served via dedicated storage (S3 or similar) — `MEDIA_ROOT` on local disk doesn't survive container restarts
- [ ] HTTPS certificate installed; HTTP redirects to HTTPS
- [ ] Rotate any secret that ever appeared in git history

### Post-launch (within first week)

- [ ] Run `pip-audit` or `safety check` against `requirements.txt`
- [ ] Add monitoring/alerting (Sentry, simple email on 500s)
- [ ] Schedule database backups separate from `daily_database_backup` Celery task
- [ ] Review audit log for unexpected actions
