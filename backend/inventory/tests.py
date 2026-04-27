from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal
from io import BytesIO
import zipfile

from .models import Category, Product, Supplier, StockMovement, PurchaseOrder, PurchaseOrderItem, PriceHistory

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

    def test_price_ttc_is_public_sale_price_without_vat(self):
        """Le prix public n'ajoute plus automatiquement la TVA."""
        self.assertEqual(self.product.price_ttc, Decimal('10.00'))

    def test_profit_margin_calculation(self):
        """Test calcul de la marge bénéficiaire"""
        expected_margin = Decimal('10.00') - Decimal('6.00')  # 4.00
        self.assertEqual(self.product.profit_margin, expected_margin)

    def test_profit_percentage_calculation(self):
        """Test calcul du pourcentage de marge"""
        expected_percentage = ((Decimal('10.00') - Decimal('6.00')) / Decimal('6.00')) * 100
        self.assertAlmostEqual(float(self.product.profit_percentage), float(expected_percentage), places=2)

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

    def test_import_products_from_csv_without_pandas(self):
        upload = SimpleUploadedFile(
            'products.csv',
            b'nom,ean,prix vente,quantite\nCahier import,4444444444444,12.50,7\n',
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['created'], 1)
        product = Product.objects.get(barcode='4444444444444')
        self.assertEqual(product.name, 'Cahier import')
        self.assertEqual(product.stock, 7)

    def test_import_products_from_zip_with_image(self):
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w') as archive:
            archive.writestr(
                'products.csv',
                'name,barcode,sale_price,stock\nProduit image,5555555555555,9.90,3\n',
            )
            archive.writestr('5555555555555.png', b'fake-image-content')

        upload = SimpleUploadedFile(
            'products.zip',
            zip_buffer.getvalue(),
            content_type='application/zip',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['errors'], [])
        self.assertEqual(response.data['created'], 1)
        product = Product.objects.get(barcode='5555555555555')
        self.addCleanup(product.image.delete, False)
        self.assertTrue(product.image.name.endswith('.png'))

    def test_cashier_without_stock_permission_cannot_read_products(self):
        cashier = User.objects.create_user(
            username='cashier-no-stock',
            password='cashier123',
            role='CASHIER',
            can_view_stock=False,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.get('/api/inventory/products/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cashier_with_stock_permission_can_read_products(self):
        cashier = User.objects.create_user(
            username='cashier-stock',
            password='cashier123',
            role='CASHIER',
            can_view_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.get('/api/inventory/products/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_purchase_order_full_receive_sets_received_status(self):
        supplier = Supplier.objects.create(name='Fournisseur commande')
        product = Product.objects.create(
            name='Produit commande',
            barcode='7777777777777',
            sale_price_ht=Decimal('12.00'),
            purchase_price=Decimal('4.00'),
            stock=0,
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status='PARTIAL',
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=20,
            unit_cost=Decimal('4.00'),
            received_quantity=10,
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {'items': [{'item_id': item.id, 'quantity': 10}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        order.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(item.received_quantity, 20)
        self.assertEqual(order.status, 'RECEIVED')
        self.assertEqual(response.data['order']['status'], 'RECEIVED')


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

    def test_cashier_cannot_create_supplier(self):
        cashier = User.objects.create_user(
            username='cashier',
            password='cashier123',
            role='CASHIER',
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post('/api/inventory/suppliers/', {
            'name': 'Fournisseur interdit',
        })

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cashier_cannot_create_category(self):
        cashier = User.objects.create_user(
            username='cashier-category',
            password='cashier123',
            role='CASHIER',
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post('/api/inventory/categories/', {
            'name': 'Categorie interdite',
        })

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
