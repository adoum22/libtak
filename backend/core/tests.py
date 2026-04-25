from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status

User = get_user_model()


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

    def test_me_patch_cannot_escalate_role_or_permissions(self):
        """Un utilisateur ne peut pas modifier ses propres droits via /me/."""
        cashier = User.objects.create_user(
            username='cashier',
            password='cashier123',
            role='CASHIER',
            can_view_stock=False,
            can_manage_stock=False,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.patch('/api/auth/me/', {
            'role': 'ADMIN',
            'can_view_stock': True,
            'can_manage_stock': True,
            'is_active': False,
            'first_name': 'Updated',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        cashier.refresh_from_db()
        self.assertEqual(cashier.role, 'CASHIER')
        self.assertFalse(cashier.can_view_stock)
        self.assertFalse(cashier.can_manage_stock)
        self.assertTrue(cashier.is_active)
        self.assertEqual(cashier.first_name, 'Updated')

    def test_change_password_route(self):
        self.client.credentials()
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/auth/me/change-password/', {
            'old_password': 'testpass123',
            'new_password': 'newpass123-strong',
            'new_password_confirm': 'newpass123-strong',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newpass123-strong'))


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
            'password': 'newpass123-strong',
            'password_confirm': 'newpass123-strong',
            'first_name': 'New',
            'last_name': 'User',
            'role': 'CASHIER'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(User.objects.count(), 2)
