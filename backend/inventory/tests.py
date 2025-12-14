from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal

from .models import Category, Product, Supplier, StockMovement, PriceHistory

User = get_user_model()


class ProductModelTest(TestCase):
    """Tests pour le modèle Product"""
    
    def setUp(self):
        self.category = Category.objects.create(name='Livres', description='Tous les livres')
        self.supplier = Supplier.objects.create(name='Fournisseur Test', email='test@supplier.com')
        self.product = Product.objects.create(
            name='Cahier 100 pages',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('6.00'),
            tva=Decimal('20.00'),
            stock=50,
            min_stock=10,
            category=self.category,
            supplier=self.supplier
        )
    
    def test_product_creation(self):
        """Test création produit avec propriétés calculées"""
        self.assertEqual(self.product.name, 'Cahier 100 pages')
        self.assertEqual(self.product.barcode, '1234567890123')
        self.assertEqual(self.product.stock, 50)
    
    def test_price_ttc_calculation(self):
        """Test calcul du prix TTC"""
        expected_ttc = Decimal('10.00') * Decimal('1.20')  # 10 + 20%
        self.assertEqual(self.product.price_ttc, expected_ttc)
    
    def test_profit_margin_calculation(self):
        """Test calcul de la marge bénéficiaire"""
        expected_margin = Decimal('10.00') - Decimal('6.00')  # 4.00
        self.assertEqual(self.product.profit_margin, expected_margin)
    
    def test_profit_percentage_calculation(self):
        """Test calcul du pourcentage de marge"""
        expected_percentage = ((Decimal('10.00') - Decimal('6.00')) / Decimal('6.00')) * 100
        self.assertAlmostEqual(self.product.profit_percentage, float(expected_percentage), places=2)
    
    def test_is_low_stock(self):
        """Test détection stock bas"""
        self.assertFalse(self.product.is_low_stock)  # 50 > 10
        self.product.stock = 5
        self.product.save()
        self.assertTrue(self.product.is_low_stock)  # 5 <= 10
    
    def test_stock_value_calculation(self):
        """Test valeur du stock"""
        expected_value = 50 * Decimal('6.00')  # 300.00
        self.assertEqual(self.product.stock_value, expected_value)


class StockMovementTest(TestCase):
    """Tests pour les mouvements de stock"""
    
    def setUp(self):
        self.user = User.objects.create_user(username='testuser', password='test123')
        self.product = Product.objects.create(
            name='Stylo Bic',
            barcode='9876543210123',
            sale_price_ht=Decimal('2.00'),
            purchase_price=Decimal('1.00'),
            stock=100,
            min_stock=20
        )
    
    def test_stock_in_movement(self):
        """Test entrée de stock"""
        initial_stock = self.product.stock
        movement = StockMovement.objects.create(
            product=self.product,
            movement_type=StockMovement.MovementType.IN,
            quantity=50,
            created_by=self.user
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, initial_stock + 50)
        self.assertEqual(movement.stock_before, initial_stock)
        self.assertEqual(movement.stock_after, initial_stock + 50)
    
    def test_stock_out_movement(self):
        """Test sortie de stock"""
        initial_stock = self.product.stock
        movement = StockMovement.objects.create(
            product=self.product,
            movement_type=StockMovement.MovementType.OUT,
            quantity=30,
            created_by=self.user
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, initial_stock - 30)
    
    def test_stock_adjust_movement(self):
        """Test ajustement de stock"""
        movement = StockMovement.objects.create(
            product=self.product,
            movement_type=StockMovement.MovementType.ADJUST,
            quantity=75,  # Nouvelle valeur absolue
            created_by=self.user
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 75)


class CategoryTest(TestCase):
    """Tests pour les catégories"""
    
    def test_category_creation(self):
        category = Category.objects.create(
            name='Fournitures',
            description='Fournitures scolaires',
            icon='book',
            color='#3B82F6'
        )
        self.assertEqual(str(category), 'Fournitures')
        self.assertEqual(category.icon, 'book')


class InventoryAPITest(APITestCase):
    """Tests API pour l'inventaire"""
    
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        self.category = Category.objects.create(name='Test Category')
        
        # Authentification
        response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
    
    def test_list_products(self):
        """Test liste des produits"""
        Product.objects.create(
            name='Test Product',
            barcode='1111111111111',
            sale_price_ht=Decimal('5.00'),
            stock=10
        )
        response = self.client.get('/api/inventory/products/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_create_product(self):
        """Test création de produit via API"""
        data = {
            'name': 'Nouveau Produit',
            'barcode': '2222222222222',
            'sale_price_ht': '15.00',
            'purchase_price': '10.00',
            'stock': 25,
            'min_stock': 5,
            'tva': '20.00'
        }
        response = self.client.post('/api/inventory/products/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Product.objects.filter(barcode='2222222222222').exists())
    
    def test_search_product_by_barcode(self):
        """Test recherche par code-barres"""
        Product.objects.create(
            name='Produit Recherché',
            barcode='3333333333333',
            sale_price_ht=Decimal('8.00'),
            stock=15
        )
        response = self.client.get('/api/inventory/products/?barcode=3333333333333')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_product_stats(self):
        """Test endpoint stats produits"""
        response = self.client.get('/api/inventory/products/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class SupplierAPITest(APITestCase):
    """Tests API pour les fournisseurs"""
    
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
    
    def test_create_supplier(self):
        """Test création fournisseur"""
        data = {
            'name': 'Nouveau Fournisseur',
            'email': 'supplier@example.com',
            'phone': '0612345678',
            'active': True
        }
        response = self.client.post('/api/inventory/suppliers/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
    
    def test_list_suppliers(self):
        """Test liste des fournisseurs"""
        Supplier.objects.create(name='Fournisseur A')
        Supplier.objects.create(name='Fournisseur B')
        response = self.client.get('/api/inventory/suppliers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
