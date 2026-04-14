from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from unittest.mock import patch

User = get_user_model()

# Use a dummy cache so throttle counters never accumulate during tests.
_NO_THROTTLE = override_settings(
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}
)


def _auth(client, username, password):
    """Login and return JWT access token. Returns '' on failure."""
    resp = client.post('/api/auth/login/', {'username': username, 'password': password})
    return resp.data.get('access', '')


def _bearer(client, token):
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')


class UserModelTest(TestCase):
    """Tests pour le modèle User personnalisé"""
    
    def test_create_admin_user(self):
        """Test création utilisateur admin"""
        user = User.objects.create_user(
            username='testadmin',
            email='admin@test.com',
            password='testpass123',
            role='ADMIN'
        )
        self.assertEqual(user.username, 'testadmin')
        self.assertEqual(user.role, 'ADMIN')
        self.assertTrue(user.is_active)
    
    def test_create_cashier_user(self):
        """Test création utilisateur caissier"""
        user = User.objects.create_user(
            username='testcashier',
            email='cashier@test.com',
            password='testpass123',
            role='CASHIER'
        )
        self.assertEqual(user.role, 'CASHIER')
        self.assertFalse(user.can_manage_stock)
    
    def test_user_permissions(self):
        """Test permissions utilisateur"""
        user = User.objects.create_user(
            username='testperm',
            password='testpass123',
            can_view_stock=True,
            can_manage_stock=False
        )
        self.assertTrue(user.can_view_stock)
        self.assertFalse(user.can_manage_stock)


@_NO_THROTTLE
class AuthenticationAPITest(APITestCase):
    """Tests pour l'API d'authentification"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            email='test@test.com',
            password='testpass123',
            role='ADMIN'
        )
    
    def test_login_success(self):
        """Test connexion réussie"""
        response = self.client.post('/api/auth/login/', {
            'username': 'testuser',
            'password': 'testpass123'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
    
    def test_login_invalid_credentials(self):
        """Test connexion avec mauvais mot de passe"""
        response = self.client.post('/api/auth/login/', {
            'username': 'testuser',
            'password': 'wrongpassword'
        })
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
    
    def test_protected_endpoint_without_token(self):
        """Test accès endpoint protégé sans token"""
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
    
    def test_protected_endpoint_with_token(self):
        """Test accès endpoint protégé avec token"""
        # Get token
        login_response = self.client.post('/api/auth/login/', {
            'username': 'testuser',
            'password': 'testpass123'
        })
        token = login_response.data['access']
        
        # Access protected endpoint
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['username'], 'testuser')


@_NO_THROTTLE
class UserAPITest(APITestCase):
    """Tests pour l'API de gestion des utilisateurs"""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        # Authenticate as admin
        login_response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = login_response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
    
    def test_list_users(self):
        """Test liste des utilisateurs"""
        response = self.client.get('/api/auth/users/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_create_user(self):
        """Test création utilisateur via API"""
        response = self.client.post('/api/auth/users/', {
            'username': 'newuser',
            'email': 'new@test.com',
            'password': 'newpass123',
            'password_confirm': 'newpass123',
            'first_name': 'New',
            'last_name': 'User',
            'role': 'CASHIER'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.count(), 2)


# ---------------------------------------------------------------------------
# S-04 / S-14 — Password strength
# ---------------------------------------------------------------------------

@_NO_THROTTLE
class PasswordStrengthTest(APITestCase):
    """Ensure short passwords are rejected at the API boundary."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_pw', password='Adm1nPass!', role='ADMIN'
        )
        _bearer(self.client, _auth(self.client, 'admin_pw', 'Adm1nPass!'))

    def test_create_user_rejects_short_password(self):
        resp = self.client.post('/api/auth/users/', {
            'username': 'weakpw',
            'email': 'wp@test.com',
            'password': 'abc',
            'password_confirm': 'abc',
            'role': 'CASHIER',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_user_rejects_password_mismatch(self):
        resp = self.client.post('/api/auth/users/', {
            'username': 'mismatch',
            'email': 'mm@test.com',
            'password': 'StrongPass1',
            'password_confirm': 'StrongPass2',
            'role': 'CASHIER',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_password_rejects_short_password(self):
        target = User.objects.create_user(
            username='target_user', password='OldPass123', role='CASHIER'
        )
        resp = self.client.post(
            f'/api/auth/users/{target.id}/reset_password/',
            {'new_password': 'short'},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reset_password_requires_new_password_field(self):
        target = User.objects.create_user(
            username='target2', password='OldPass123', role='CASHIER'
        )
        resp = self.client.post(f'/api/auth/users/{target.id}/reset_password/', {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Permission boundary — cashier cannot reach admin endpoints
# ---------------------------------------------------------------------------

@_NO_THROTTLE
class PermissionBoundaryTest(APITestCase):
    """Cashier-role users must not access admin-only endpoints."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='adm', password='Admin1234!', role='ADMIN'
        )
        self.cashier = User.objects.create_user(
            username='cas', password='Cash1234!', role='CASHIER'
        )
        self.cashier_token = _auth(self.client, 'cas', 'Cash1234!')
        self.assertNotEqual(self.cashier_token, '', 'Cashier login failed in setUp')

    def _as_cashier(self):
        _bearer(self.client, self.cashier_token)

    # User management — admin only
    def test_cashier_cannot_list_users(self):
        self._as_cashier()
        resp = self.client.get('/api/auth/users/')
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_cashier_cannot_create_user(self):
        self._as_cashier()
        resp = self.client.post('/api/auth/users/', {
            'username': 'hack', 'password': 'HackPass1', 'role': 'ADMIN'
        })
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_cashier_cannot_reset_another_users_password(self):
        self._as_cashier()
        resp = self.client.post(
            f'/api/auth/users/{self.admin.id}/reset_password/',
            {'new_password': 'NewAdmin99'},
        )
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_cashier_cannot_access_settings(self):
        self._as_cashier()
        resp = self.client.get('/api/auth/settings/')
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_401_UNAUTHORIZED])

    # Unauthenticated — must always get 401
    def test_unauthenticated_cannot_access_me(self):
        self.client.credentials()
        resp = self.client.get('/api/auth/me/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_cannot_list_users(self):
        self.client.credentials()
        resp = self.client.get('/api/auth/users/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    # Admin can do everything the cashier cannot
    def test_admin_can_list_users(self):
        _bearer(self.client, _auth(self.client, 'adm', 'Admin1234!'))
        resp = self.client.get('/api/auth/users/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# S-13 — Sync token validation
# ---------------------------------------------------------------------------

@_NO_THROTTLE
@override_settings(SYNC_TOKEN='test-valid-token-32chars-abcdefgh')
class SyncTokenPermissionTest(APITestCase):
    """SyncTokenPermission must accept valid tokens and reject everything else."""

    VALID_TOKEN = 'test-valid-token-32chars-abcdefgh'

    def _post(self, auth_header=None, data=None):
        headers = {}
        if auth_header is not None:
            headers['HTTP_AUTHORIZATION'] = auth_header
        return self.client.post(
            '/api/auth/sync/receive/',
            data or {},
            format='json',
            **headers,
        )

    def test_valid_token_accepted(self):
        resp = self._post(f'SyncToken {self.VALID_TOKEN}', {'sales': [], 'returns': [], 'stock_updates': []})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_wrong_token_rejected(self):
        resp = self._post('SyncToken wrong-token')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_missing_authorization_header_rejected(self):
        resp = self._post(auth_header=None)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bearer_token_not_accepted_for_sync(self):
        """JWT Bearer tokens must not work on sync endpoints."""
        user = User.objects.create_user(
            username='syncadm', password='SyncPass1', role='ADMIN'
        )
        jwt = _auth(self.client, 'syncadm', 'SyncPass1')
        resp = self._post(f'Bearer {jwt}')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(SYNC_TOKEN=None)
    def test_no_sync_token_configured_rejects_all(self):
        """When SYNC_TOKEN is not set, every request must be denied."""
        resp = self._post(f'SyncToken {self.VALID_TOKEN}')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ---------------------------------------------------------------------------
# S-05 — Inactive user cannot log in
# ---------------------------------------------------------------------------

@_NO_THROTTLE
class InactiveUserLoginTest(APITestCase):
    """Disabled accounts must receive a clear rejection, not a token."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='inactive_u', password='InactivePass1', role='CASHIER', is_active=False
        )

    def test_inactive_user_cannot_login(self):
        resp = self.client.post('/api/auth/login/', {
            'username': 'inactive_u',
            'password': 'InactivePass1',
        })
        # Must NOT be 200
        self.assertNotEqual(resp.status_code, status.HTTP_200_OK)
        self.assertNotIn('access', resp.data)
