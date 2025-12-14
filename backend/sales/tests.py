from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal

from inventory.models import Product
from .models import Sale, SaleItem, Discount, Return, ReturnItem

User = get_user_model()


class SaleModelTest(TestCase):
    """Tests pour le modèle Sale"""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='cashier',
            password='cashier123',
            role='CASHIER'
        )
        self.product = Product.objects.create(
            name='Test Product',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('6.00'),
            tva=Decimal('20.00'),
            stock=100
        )
    
    def test_sale_creation(self):
        """Test création d'une vente"""
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('10.00'),
            total_tva=Decimal('2.00'),
            total_ttc=Decimal('12.00'),
            payment_method='CASH'
        )
        self.assertEqual(sale.total_ttc, Decimal('12.00'))
        self.assertEqual(sale.payment_method, 'CASH')


class DiscountModelTest(TestCase):
    """Tests pour le modèle Discount"""
    
    def test_percentage_discount(self):
        """Test remise en pourcentage"""
        discount = Discount.objects.create(
            name='Promo 10%',
            code='PROMO10',
            discount_type='PERCENTAGE',
            value=Decimal('10.00'),
            active=True
        )
        # 10% de 100 = 10
        result = discount.calculate_discount(Decimal('100.00'))
        self.assertEqual(result, Decimal('10.00'))
    
    def test_fixed_discount(self):
        """Test remise fixe"""
        discount = Discount.objects.create(
            name='Moins 5 DH',
            code='MOINS5',
            discount_type='FIXED',
            value=Decimal('5.00'),
            active=True
        )
        result = discount.calculate_discount(Decimal('50.00'))
        self.assertEqual(result, Decimal('5.00'))
    
    def test_min_purchase_requirement(self):
        """Test montant minimum d'achat"""
        discount = Discount.objects.create(
            name='Promo 20%',
            discount_type='PERCENTAGE',
            value=Decimal('20.00'),
            min_purchase=Decimal('100.00'),
            active=True
        )
        # Sous le minimum - pas de remise
        result = discount.calculate_discount(Decimal('50.00'))
        self.assertEqual(result, 0)
        
        # Au-dessus du minimum - remise appliquée
        result = discount.calculate_discount(Decimal('150.00'))
        self.assertEqual(result, Decimal('30.00'))
    
    def test_discount_validity(self):
        """Test validité des remises"""
        from django.utils import timezone
        from datetime import timedelta
        
        # Remise active
        active_discount = Discount.objects.create(
            name='Active',
            discount_type='PERCENTAGE',
            value=Decimal('10.00'),
            active=True
        )
        self.assertTrue(active_discount.is_valid)
        
        # Remise inactive
        inactive_discount = Discount.objects.create(
            name='Inactive',
            discount_type='PERCENTAGE',
            value=Decimal('10.00'),
            active=False
        )
        self.assertFalse(inactive_discount.is_valid)


class SalesAPITest(APITestCase):
    """Tests API pour les ventes"""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='cashier',
            password='cashier123',
            role='CASHIER'
        )
        self.product = Product.objects.create(
            name='Test Product',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('6.00'),
            tva=Decimal('20.00'),
            stock=100
        )
        
        # Authentification
        response = self.client.post('/api/auth/login/', {
            'username': 'cashier',
            'password': 'cashier123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
    
    def test_create_sale(self):
        """Test création d'une vente via API"""
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 2}
            ],
            'payment_method': 'CASH'
        }
        response = self.client.post('/api/sales/sales/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Vérifier décrémentation stock
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 98)  # 100 - 2
    
    def test_insufficient_stock(self):
        """Test vente avec stock insuffisant"""
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 200}  # Plus que le stock
            ],
            'payment_method': 'CASH'
        }
        response = self.client.post('/api/sales/sales/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
    
    def test_list_sales(self):
        """Test liste des ventes"""
        response = self.client.get('/api/sales/sales/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class DiscountAPITest(APITestCase):
    """Tests API pour les remises"""
    
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
    
    def test_create_discount(self):
        """Test création d'une remise"""
        data = {
            'name': 'Nouvelle Promo',
            'code': 'NEWPROMO',
            'discount_type': 'PERCENTAGE',
            'value': '15.00',
            'active': True
        }
        response = self.client.post('/api/sales/discounts/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_apply_discount(self):
        """Test application d'un code promo"""
        Discount.objects.create(
            name='Test Discount',
            code='TESTCODE',
            discount_type='PERCENTAGE',
            value=Decimal('10.00'),
            active=True
        )
        data = {
            'code': 'TESTCODE',
            'subtotal': '100.00'
        }
        response = self.client.post('/api/sales/discounts/apply/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(float(response.data['discount_amount']), 10.0)
    
    def test_invalid_discount_code(self):
        """Test code promo invalide"""
        data = {
            'code': 'INVALIDCODE',
            'subtotal': '100.00'
        }
        response = self.client.post('/api/sales/discounts/apply/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ReturnAPITest(APITestCase):
    """Tests API pour les retours"""
    
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        self.product = Product.objects.create(
            name='Test Product',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            tva=Decimal('20.00'),
            stock=100
        )
        
        response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
        
        # Créer une vente pour le retour
        sale_data = {
            'items': [{'product_id': self.product.id, 'quantity': 5}],
            'payment_method': 'CASH'
        }
        sale_response = self.client.post('/api/sales/sales/', sale_data, format='json')
        self.sale = Sale.objects.get(id=sale_response.data['id'])
        self.sale_item = self.sale.items.first()
    
    def test_create_return(self):
        """Test création d'un retour"""
        self.product.refresh_from_db()
        stock_before = self.product.stock  # 95 après la vente
        
        data = {
            'sale': self.sale.id,
            'reason': 'Produit défectueux',
            'items': [
                {'sale_item': self.sale_item.id, 'quantity': 2}
            ]
        }
        response = self.client.post('/api/sales/returns/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Vérifier que le stock a été restauré
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before + 2)
