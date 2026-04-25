from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import serializers, status
from decimal import Decimal

from inventory.models import Product
from .models import Sale, SaleItem, Discount, Return, ReturnItem
from .serializers import SaleSerializer

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

    def test_duplicate_sale_items_are_aggregated_for_stock_check(self):
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 2},
                {'product_id': self.product.id, 'quantity': 3},
            ],
            'payment_method': 'CASH'
        }
        response = self.client.post('/api/sales/sales/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 95)
        sale = Sale.objects.get(id=response.data['id'])
        self.assertEqual(sale.items.count(), 1)
        self.assertEqual(sale.items.first().quantity, 5)
    
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

    def test_stock_decrement_rechecks_stale_stock_atomically(self):
        stale_product = Product.objects.get(pk=self.product.pk)
        Product.objects.filter(pk=self.product.pk).update(stock=1)

        serializer = SaleSerializer()
        with self.assertRaises(serializers.ValidationError):
            serializer._decrement_product_stock(stale_product, 2)

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)
    
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

    def test_cashier_cannot_create_discount(self):
        cashier = User.objects.create_user(
            username='cashier-discount',
            password='cashier123',
            role='CASHIER',
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post('/api/sales/discounts/', {
            'name': 'Interdit',
            'discount_type': 'PERCENTAGE',
            'value': '10.00',
        })

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


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

    def test_return_item_must_belong_to_sale(self):
        other_product = Product.objects.create(
            name='Other Product',
            barcode='9999999999999',
            sale_price_ht=Decimal('5.00'),
            tva=Decimal('20.00'),
            stock=20
        )
        other_sale_response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': other_product.id, 'quantity': 1}],
            'payment_method': 'CASH'
        }, format='json')
        other_sale_item = Sale.objects.get(id=other_sale_response.data['id']).items.first()

        response = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Mauvaise vente',
            'items': [{'sale_item': other_sale_item.id, 'quantity': 1}]
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_return_quantity_cannot_exceed_remaining_sold_quantity(self):
        response = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Trop',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 6}]
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_return_quantity_accounts_for_previous_returns(self):
        first = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Premier retour',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 4}]
        }, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Deuxieme retour',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 2}]
        }, format='json')

        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cashier_cannot_create_return(self):
        cashier = User.objects.create_user(
            username='cashier-return',
            password='cashier123',
            role='CASHIER',
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Interdit',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 1}]
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
