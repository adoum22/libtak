from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal
from datetime import timedelta
from io import BytesIO
import os
import tempfile
import uuid
import zipfile

from PIL import Image

from .models import (
    Category,
    InventoryCount,
    InventoryCountItem,
    PriceHistory,
    Product,
    ProductCostLayer,
    PurchaseOrder,
    PurchaseOrderItem,
    StockMovement,
    Supplier,
)
from core.models import AuditLog

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

    def test_fifo_sale_price_does_not_override_current_product_price(self):
        product = Product.objects.create(
            name='Produit gratuit par lot',
            barcode='1234567890124',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('2.00'),
            stock=1,
        )
        ProductCostLayer.create_layer(
            product,
            1,
            unit_cost=Decimal('2.00'),
            sale_price=Decimal('0.00'),
        )

        self.assertEqual(product.price_ttc, Decimal('10.00'))
        self.assertEqual(product.profit_margin, Decimal('8.00'))
        breakdown = ProductCostLayer.consume_fifo_breakdown(product, 1)
        self.assertEqual(breakdown[0]['sale_price'], Decimal('10.00'))


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
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 150)

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

    def test_stock_out_cannot_exceed_available_stock(self):
        with self.assertRaises(ValidationError):
            StockMovement.objects.create(
                product=self.product,
                movement_type=StockMovement.MovementType.OUT,
                quantity=101,
                created_by=self.user,
            )

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 100)
        self.assertEqual(ProductCostLayer.objects.filter(product=self.product).count(), 0)

    def test_invalid_movement_type_does_not_change_stock(self):
        with self.assertRaises(ValidationError):
            StockMovement.objects.create(
                product=self.product,
                movement_type='UNKNOWN',
                quantity=1,
                created_by=self.user,
            )

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 100)
        self.assertFalse(StockMovement.objects.filter(product=self.product).exists())

    def test_fifo_reconciliation_repairs_missing_and_excess_layers(self):
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('1.00'),
            sale_price=Decimal('2.00'),
            initial_quantity=120,
            remaining_quantity=120,
        )

        call_command('reconcile_fifo', product=self.product.pk)
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 120)

        call_command('reconcile_fifo', '--apply', product=self.product.pk)
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 100)

    def test_database_constraints_reject_negative_product_and_layer_prices(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Product.objects.create(
                name='Produit invalide DB',
                barcode='9876543210999',
                sale_price_ht=Decimal('-1.00'),
                stock=0,
            )

        with self.assertRaises(IntegrityError), transaction.atomic():
            ProductCostLayer.objects.create(
                product=self.product,
                unit_cost=Decimal('-1.00'),
                sale_price=Decimal('2.00'),
                initial_quantity=1,
                remaining_quantity=1,
            )


class SyncInventoryIntegrationTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='sync-user',
            password='unused-password',
            role='ADMIN',
        )
        self.product = Product.objects.create(
            name='Produit synchronise',
            barcode='3030303030303',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('5.00'),
            stock=5,
        )
        ProductCostLayer.create_layer(self.product, 5)
        self.origin_id = str(uuid.uuid4())

    def test_sale_and_return_sync_preserves_contract_without_stock_side_effects(self):
        from core.sync_api import _acknowledge, _import_return, _import_sale
        from core.sync_service import SyncService, make_sync_id
        from sales.models import Return, ReturnItem, Sale, SaleItem

        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('10.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('10.00'),
            discount_amount=Decimal('0.00'),
            amount_received=Decimal('20.00'),
            change_amount=Decimal('10.00'),
            payment_method=Sale.PaymentMethod.CASH,
            idempotency_payload_hash='a' * 64,
        )
        sale_item = SaleItem.objects.create(
            sale=sale,
            product=self.product,
            product_name=self.product.name,
            quantity=2,
            unit_price_ht=Decimal('5.00'),
            total_price_ht=Decimal('10.00'),
            tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('2.00'),
            total_purchase_cost=Decimal('4.00'),
        )
        return_order = Return.objects.create(
            sale=sale,
            reason='Test sync',
            refund_amount=Decimal('5.00'),
            refund_method=Sale.PaymentMethod.CASH,
            status=Return.ReturnStatus.PENDING,
            processed_by=self.user,
            idempotency_payload_hash='b' * 64,
        )
        ReturnItem.objects.create(
            return_order=return_order,
            sale_item=sale_item,
            quantity=1,
            restock=True,
        )
        service = SyncService(origin_id=self.origin_id)

        sale_payload = service._serialize_sale(sale, self.origin_id)
        self.assertEqual(sale_payload['amount_received'], '20.00')
        self.assertEqual(sale_payload['change_amount'], '10.00')
        self.assertEqual(sale_payload['idempotency_payload_hash'], 'a' * 64)
        sale_ack = _acknowledge(
            [sale_payload], _import_sale, self.origin_id, 'sale'
        )
        self.assertEqual(sale_ack[0]['status'], 'created')

        return_payload = service._serialize_return(return_order, self.origin_id)
        self.assertEqual(return_payload['status'], Return.ReturnStatus.PENDING)
        self.assertTrue(return_payload['items'][0]['restock'])
        self.assertEqual(return_payload['idempotency_payload_hash'], 'b' * 64)
        return_ack = _acknowledge(
            [return_payload], _import_return, self.origin_id, 'return'
        )
        self.assertEqual(return_ack[0]['status'], 'created')

        imported_sale = Sale.objects.get(local_sync_id=sale_payload['sync_id'])
        imported_return = Return.objects.get(
            local_sync_id=return_payload['sync_id']
        )
        self.assertEqual(imported_sale.idempotency_payload_hash, 'a' * 64)
        self.assertEqual(imported_sale.amount_received, Decimal('20.00'))
        self.assertEqual(imported_sale.change_amount, Decimal('10.00'))
        self.assertEqual(imported_return.status, Return.ReturnStatus.PENDING)
        self.assertEqual(imported_return.idempotency_payload_hash, 'b' * 64)
        self.assertTrue(imported_return.items.get().restock)

        return_order.status = Return.ReturnStatus.COMPLETED
        return_order.stock_restored_at = return_order.updated_at
        return_order.completed_at = return_order.updated_at
        return_order.save(update_fields=[
            'status', 'stock_restored_at', 'completed_at', 'updated_at'
        ])
        completed_payload = service._serialize_return(
            return_order,
            self.origin_id,
        )
        completed_ack = _acknowledge(
            [completed_payload], _import_return, self.origin_id, 'return'
        )
        self.assertEqual(completed_ack[0]['status'], 'updated')

        replay_ack = _acknowledge(
            [completed_payload], _import_return, self.origin_id, 'return'
        )
        self.assertEqual(replay_ack[0]['status'], 'duplicate')
        tampered_payload = dict(completed_payload)
        tampered_payload['reason'] = 'Tentative de mutation terminale'
        tampered_ack = _acknowledge(
            [tampered_payload], _import_return, self.origin_id, 'return'
        )
        self.assertEqual(tampered_ack[0]['status'], 'rejected')
        self.assertEqual(
            tampered_ack[0]['error_code'],
            'idempotency_conflict',
        )

        excessive_payload = dict(completed_payload)
        excessive_payload.update({
            'local_id': '999',
            'sync_id': make_sync_id(self.origin_id, 'return', 999),
            'status': Return.ReturnStatus.PENDING,
            'reason': 'Retour cumulé excessif',
            'refund_amount': '10.00',
            'stock_restored_at': None,
            'completed_at': None,
            'items': [{**completed_payload['items'][0], 'quantity': 2}],
        })
        excessive_ack = _acknowledge(
            [excessive_payload], _import_return, self.origin_id, 'return'
        )
        self.assertEqual(excessive_ack[0]['status'], 'rejected')

        imported_return.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(imported_return.status, Return.ReturnStatus.COMPLETED)
        self.assertEqual(
            imported_return.completed_at,
            return_order.completed_at,
        )
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 5)
        self.assertFalse(
            StockMovement.objects.filter(product=self.product).exists()
        )

    def test_stock_sync_reconciles_fifo_without_changing_master_timestamp(self):
        from core.sync_api import _import_stock_update
        from core.sync_service import make_stock_sync_id

        updated_at = self.product.updated_at
        outcome, _validated = _import_stock_update(
            {
                'sync_id': make_stock_sync_id(
                    self.origin_id,
                    self.product.barcode,
                ),
                'barcode': self.product.barcode,
                'stock': 2,
                'updated_at': updated_at.isoformat(),
            },
            self.origin_id,
        )

        self.product.refresh_from_db()
        self.assertEqual(outcome, 'applied')
        self.assertEqual(self.product.stock, 2)
        self.assertEqual(self.product.updated_at, updated_at)
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 2)

    def test_stock_sync_is_monotonic_and_aggregates_origins(self):
        from core.sync_api import SyncRecordError, _import_stock_update
        from core.sync_service import make_stock_sync_id

        second_origin = str(uuid.uuid4())
        base_time = timezone.now()

        def record(origin, stock, moment):
            return {
                'sync_id': make_stock_sync_id(origin, self.product.barcode),
                'barcode': self.product.barcode,
                'stock': stock,
                'updated_at': moment.isoformat(),
            }

        _import_stock_update(record(self.origin_id, 5, base_time), self.origin_id)
        _import_stock_update(record(second_origin, 3, base_time), second_origin)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 8)

        newer_time = base_time + timedelta(seconds=1)
        _import_stock_update(
            record(self.origin_id, 4, newer_time),
            self.origin_id,
        )
        stale_outcome, _ = _import_stock_update(
            record(self.origin_id, 99, base_time),
            self.origin_id,
        )
        self.assertEqual(stale_outcome, 'stale')
        with self.assertRaises(SyncRecordError):
            _import_stock_update(
                record(self.origin_id, 6, newer_time),
                self.origin_id,
            )

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 7)
        self.assertEqual(ProductCostLayer.active_quantity(self.product), 7)

    def test_sync_batches_never_exceed_server_limit_and_are_fair(self):
        from core.sync_service import MAX_RECORDS_PER_BATCH, SyncService

        record_sets = {
            'sales': [{'sync_id': f'sale-{index}'} for index in range(10005)],
            'returns': [{'sync_id': 'return-1'}],
            'stock_updates': [{'sync_id': 'stock-1'}],
        }
        batches = list(SyncService._record_batches(record_sets))

        self.assertEqual(len(batches), 2)
        self.assertTrue(all(
            sum(len(records) for records in batch.values())
            <= MAX_RECORDS_PER_BATCH
            for batch in batches
        ))
        self.assertEqual(len(batches[0]['returns']), 1)
        self.assertEqual(len(batches[0]['stock_updates']), 1)
        self.assertEqual(
            sum(len(batch['sales']) for batch in batches),
            10005,
        )

    def test_master_price_sync_updates_public_price_without_repricing_fifo_cost(self):
        from core.sync_service import SyncService

        original_layer = self.product.cost_layers.get()
        created = SyncService._import_products([{
            'barcode': self.product.barcode,
            'name': self.product.name,
            'description': '',
            'category_name': None,
            'supplier_name': None,
            'purchase_price': '9.00',
            'sale_price_ht': '12.00',
            'tva': '20.00',
            'min_stock': 2,
            'active': True,
        }])

        self.assertEqual(created, 0)
        self.product.refresh_from_db()
        original_layer.refresh_from_db()
        history = PriceHistory.objects.get(product=self.product)
        self.assertEqual(self.product.purchase_price, Decimal('9.00'))
        self.assertEqual(self.product.sale_price_ht, Decimal('12.00'))
        self.assertEqual(original_layer.unit_cost, Decimal('2.00'))
        self.assertEqual(original_layer.sale_price, Decimal('12.00'))
        self.assertIsNone(history.changed_by)


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


class ImageCleanupTest(TestCase):
    def setUp(self):
        self.media_directory = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            MEDIA_ROOT=self.media_directory.name
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media_directory.cleanup)

    def _image_upload(self, name, color):
        image_buffer = BytesIO()
        Image.new('RGB', (2, 2), color=color).save(
            image_buffer,
            format='PNG',
        )
        return SimpleUploadedFile(
            name,
            image_buffer.getvalue(),
            content_type='image/png',
        )

    def test_replacing_product_image_deletes_previous_file_after_commit(self):
        product = Product.objects.create(
            name='Produit image remplacee',
            barcode='1010101010101',
            sale_price_ht=Decimal('1.00'),
            image=self._image_upload('before.png', 'white'),
        )
        old_path = product.image.path
        self.assertTrue(os.path.exists(old_path))

        with self.captureOnCommitCallbacks(execute=True):
            product.image = self._image_upload('after.png', 'black')
            product.save(update_fields=['image'])

        self.assertFalse(os.path.exists(old_path))
        self.assertTrue(os.path.exists(product.image.path))

    def test_deleting_supplier_deletes_its_image_after_commit(self):
        supplier = Supplier.objects.create(
            name='Fournisseur image supprimee',
            image=self._image_upload('supplier.png', 'blue'),
        )
        image_path = supplier.image.path
        self.assertTrue(os.path.exists(image_path))

        with self.captureOnCommitCallbacks(execute=True):
            supplier.delete()

        self.assertFalse(os.path.exists(image_path))

    def test_rolled_back_image_replacement_keeps_previous_file(self):
        product = Product.objects.create(
            name='Produit image rollback',
            barcode='1010101010102',
            sale_price_ht=Decimal('1.00'),
            image=self._image_upload('stable.png', 'white'),
        )
        old_name = product.image.name
        old_path = product.image.path

        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                product.image = self._image_upload('rollback.png', 'black')
                product.save(update_fields=['image'])
                raise RuntimeError('rollback test')

        product.refresh_from_db()
        self.assertEqual(product.image.name, old_name)
        self.assertTrue(os.path.exists(old_path))


class InventoryAPITest(APITestCase):
    """Tests API pour l'inventaire"""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        self.category = Category.objects.create(name='Test Category')

        self.client.force_authenticate(user=self.admin)

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
        product = Product.objects.get(barcode='2222222222222')
        self.assertEqual(product.cost_layers.count(), 1)
        self.assertEqual(ProductCostLayer.active_quantity(product), product.stock)
        movement = StockMovement.objects.get(product=product)
        self.assertEqual(movement.movement_type, StockMovement.MovementType.IN)
        self.assertEqual(movement.quantity, 25)
        self.assertEqual(movement.stock_before, 0)
        self.assertEqual(movement.stock_after, 25)
        self.assertEqual(movement.created_by, self.admin)
        self.assertEqual(movement.cost_layer, product.cost_layers.get())
        self.assertTrue(AuditLog.objects.filter(
            action=AuditLog.ActionType.CREATE,
            model_name='Product',
            object_id=product.pk,
            user=self.admin,
        ).exists())

    def test_high_profit_percentage_is_serialized_without_server_error(self):
        product = Product.objects.create(
            name='Produit forte marge',
            barcode='2222222222299',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('20.00'),
            stock=1,
        )
        ProductCostLayer.create_layer(product, 1)

        response = self.client.get(f'/api/inventory/products/{product.pk}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            Decimal(response.data['profit_percentage']),
            Decimal('1900.00'),
        )

    def test_pos_price_layers_all_expose_the_current_product_price(self):
        product = Product.objects.create(
            name='Produit onze lots',
            barcode='2222222222288',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=11,
        )
        for index in range(11):
            ProductCostLayer.create_layer(
                product,
                1,
                unit_cost=Decimal('1.00'),
                sale_price=Decimal('2.00') + Decimal(index) / Decimal('10'),
            )

        response = self.client.get(
            f'/api/inventory/products/pos/?barcode={product.barcode}'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        products = response.data.get('results', response.data)
        self.assertEqual(len(products), 1)
        self.assertEqual(len(products[0]['price_layers']), 11)
        self.assertEqual(
            sum(layer['remaining_quantity'] for layer in products[0]['price_layers']),
            product.stock,
        )
        self.assertEqual(
            {Decimal(layer['sale_price']) for layer in products[0]['price_layers']},
            {Decimal('2.00')},
        )

    def test_patch_cannot_change_stock_without_movement(self):
        product = Product.objects.create(
            name='Stock protégé',
            barcode='2222222222223',
            sale_price_ht=Decimal('15.00'),
            purchase_price=Decimal('10.00'),
            stock=5,
        )
        ProductCostLayer.create_layer(product, 5)

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/',
            {'stock': 999},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.stock, 5)
        self.assertEqual(ProductCostLayer.active_quantity(product), 5)

    def test_negative_product_and_fifo_prices_are_rejected(self):
        product = Product.objects.create(
            name='Prix proteges',
            barcode='2222222222224',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=1,
        )
        layer = ProductCostLayer.create_layer(product, 1)

        product_response = self.client.patch(
            f'/api/inventory/products/{product.id}/',
            {'purchase_price': '-1.00'},
            format='json',
        )
        layer_response = self.client.patch(
            f'/api/inventory/product-cost-layers/{layer.id}/',
            {'sale_price': '-1.00'},
            format='json',
        )

        self.assertEqual(
            product_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            layer_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        product.refresh_from_db()
        layer.refresh_from_db()
        self.assertEqual(product.purchase_price, Decimal('1.00'))
        self.assertEqual(layer.sale_price, Decimal('2.00'))
        self.assertFalse(PriceHistory.objects.filter(product=product).exists())

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

    def test_filter_product_by_purchase_price_in_product_or_active_layer(self):
        direct = Product.objects.create(
            name='Prix direct',
            barcode='4444444444440',
            purchase_price=Decimal('1000.00'),
            sale_price_ht=Decimal('12.00'),
            stock=1,
        )
        layered = Product.objects.create(
            name='Prix lot',
            barcode='4444444444441',
            purchase_price=Decimal('4.00'),
            sale_price_ht=Decimal('12.00'),
            stock=1,
        )
        ProductCostLayer.objects.create(
            product=layered,
            unit_cost=Decimal('1000.00'),
            sale_price=Decimal('12.00'),
            initial_quantity=1,
            remaining_quantity=1,
            note='Prix inconnu inventaire',
        )

        response = self.client.get('/api/inventory/products/?purchase_price=1000')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        products = response.data.get('results', response.data)
        barcodes = {product['barcode'] for product in products}
        self.assertIn(direct.barcode, barcodes)
        self.assertIn(layered.barcode, barcodes)

    def test_update_product_cost_layer_price(self):
        product = Product.objects.create(
            name='Lot editable',
            barcode='4444444444442',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('8.00'),
            stock=3,
        )
        layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('0.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )

        response = self.client.patch(
            f'/api/inventory/product-cost-layers/{layer.id}/',
            {'unit_cost': '3.50', 'sale_price': '7.00', 'note': 'Corrige chez ami'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layer.refresh_from_db()
        product.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('3.50'))
        self.assertEqual(layer.sale_price, Decimal('7.00'))
        self.assertEqual(layer.remaining_quantity, 3)
        self.assertEqual(product.purchase_price, Decimal('3.50'))
        self.assertEqual(product.sale_price_ht, Decimal('7.00'))
        self.assertTrue(PriceHistory.objects.filter(product=product).exists())

    def test_cost_layers_cannot_be_created_or_deleted_directly(self):
        product = Product.objects.create(
            name='Lots proteges',
            barcode='4444444444499',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=2,
        )
        layer = ProductCostLayer.create_layer(product, 2)

        create_response = self.client.post(
            '/api/inventory/product-cost-layers/',
            {
                'product': product.id,
                'unit_cost': '9.00',
                'initial_quantity': 100,
                'remaining_quantity': 100,
            },
            format='json',
        )
        delete_response = self.client.delete(
            f'/api/inventory/product-cost-layers/{layer.id}/'
        )

        self.assertEqual(
            create_response.status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            delete_response.status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(ProductCostLayer.active_quantity(product), 2)

    def test_consumed_or_invalid_fifo_layer_cannot_be_edited(self):
        product = Product.objects.create(
            name='Lot historique protege',
            barcode='4444444444498',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=0,
        )
        layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('1.00'),
            sale_price=Decimal('2.00'),
            initial_quantity=1,
            remaining_quantity=0,
        )

        historical_response = self.client.patch(
            f'/api/inventory/product-cost-layers/{layer.id}/',
            {'unit_cost': '9.00'},
            format='json',
        )
        invalid_response = self.client.patch(
            f'/api/inventory/products/{product.id}/update-cost-layer/',
            {'layer_id': 'abc', 'unit_cost': '9.00'},
            format='json',
        )

        self.assertEqual(
            historical_response.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            invalid_response.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        layer.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('1.00'))

    def test_update_product_cost_layer_through_product_endpoint(self):
        product = Product.objects.create(
            name='Lot editable produit',
            barcode='4444444444443',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('8.00'),
            stock=3,
        )
        layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('0.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/cost-layers/{layer.id}/',
            {'unit_cost': '3.50', 'sale_price': '7.00'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layer.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('3.50'))
        self.assertEqual(response.data['product']['id'], product.id)

    def test_update_product_cost_layer_by_position(self):
        product = Product.objects.create(
            name='Lot editable position',
            barcode='4444444444444',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('8.00'),
            stock=3,
        )
        first_layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('0.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=1,
            remaining_quantity=1,
        )
        ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('2.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=2,
            remaining_quantity=2,
        )

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/cost-layers/by-position/0/',
            {'unit_cost': '1.25'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        first_layer.refresh_from_db()
        self.assertEqual(first_layer.unit_cost, Decimal('1.25'))

    def test_update_product_cost_layer_explicit_endpoint(self):
        product = Product.objects.create(
            name='Lot editable endpoint',
            barcode='4444444444445',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('8.00'),
            stock=3,
        )
        layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('0.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/update-cost-layer/',
            {'layer_id': layer.id, 'unit_cost': '2.75', 'sale_price': '5.00'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layer.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('2.75'))
        self.assertEqual(layer.sale_price, Decimal('5.00'))
        product.refresh_from_db()
        self.assertEqual(product.purchase_price, Decimal('2.75'))
        self.assertEqual(product.sale_price_ht, Decimal('5.00'))
        self.assertEqual(response.data['product']['price_ttc'], Decimal('5.00'))

    def test_update_product_cost_layer_falls_back_to_position_when_id_is_stale(self):
        product = Product.objects.create(
            name='Lot stale id',
            barcode='4444444444447',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('8.00'),
            stock=3,
        )
        layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('0.00'),
            sale_price=Decimal('8.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/update-cost-layer/',
            {
                'layer_id': 999999,
                'index': 0,
                'unit_cost': '1.10',
                'sale_price': '2.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layer.refresh_from_db()
        self.assertEqual(layer.unit_cost, Decimal('1.10'))
        self.assertEqual(layer.sale_price, Decimal('2.00'))

    def test_product_price_update_keeps_fifo_costs_and_updates_all_sale_prices(self):
        product = Product.objects.create(
            name='Produit prix courant',
            barcode='4444444444446',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=3,
        )
        current_layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('1.00'),
            sale_price=Decimal('2.00'),
            initial_quantity=2,
            remaining_quantity=2,
        )
        later_layer = ProductCostLayer.objects.create(
            product=product,
            unit_cost=Decimal('1.50'),
            sale_price=Decimal('3.00'),
            initial_quantity=1,
            remaining_quantity=1,
        )

        response = self.client.patch(
            f'/api/inventory/products/{product.id}/',
            {'purchase_price': '1.25', 'sale_price_ht': '2.50'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        current_layer.refresh_from_db()
        later_layer.refresh_from_db()
        self.assertEqual(current_layer.unit_cost, Decimal('1.00'))
        self.assertEqual(current_layer.sale_price, Decimal('2.50'))
        self.assertEqual(later_layer.unit_cost, Decimal('1.50'))
        self.assertEqual(later_layer.sale_price, Decimal('2.50'))
        self.assertEqual(response.data['price_ttc'], Decimal('2.50'))
        history = PriceHistory.objects.get(product=product)
        self.assertEqual(history.old_purchase_price, Decimal('1.00'))
        self.assertEqual(history.new_purchase_price, Decimal('1.25'))
        audit = AuditLog.objects.get(
            action=AuditLog.ActionType.UPDATE,
            model_name='Product',
            object_id=product.pk,
        )
        self.assertEqual(audit.user, self.admin)
        self.assertEqual(audit.changes['before']['purchase_price'], '1.00')
        self.assertEqual(audit.changes['after']['purchase_price'], '1.25')
        self.assertEqual(
            audit.changes['fields'],
            ['purchase_price', 'sale_price_ht'],
        )

    def test_product_stats(self):
        """La valorisation globale réconcilie FIFO, fallback et détail API."""
        fallback = Product.objects.create(
            name='Stock historique sans lot',
            barcode='ZAKAT-FALLBACK-1',
            purchase_price=Decimal('6.00'),
            sale_price_ht=Decimal('10.00'),
            stock=10,
        )
        partial = Product.objects.create(
            name='Stock partiellement couvert',
            barcode='ZAKAT-PARTIAL-1',
            purchase_price=Decimal('6.00'),
            sale_price_ht=Decimal('10.00'),
            stock=5,
        )
        ProductCostLayer.create_layer(
            partial, 2, unit_cost=Decimal('4.00'), note='lot 1',
        )
        ProductCostLayer.create_layer(
            partial, 2, unit_cost=Decimal('5.00'), note='lot 2',
        )
        excess = Product.objects.create(
            name='Lots supérieurs au stock',
            barcode='ZAKAT-EXCESS-1',
            purchase_price=Decimal('6.00'),
            sale_price_ht=Decimal('10.00'),
            stock=3,
        )
        ProductCostLayer.create_layer(
            excess, 2, unit_cost=Decimal('4.00'), note='lot ancien',
        )
        ProductCostLayer.create_layer(
            excess, 3, unit_cost=Decimal('5.00'), note='lot récent',
        )

        # 10*6 = 60 ; 2*4 + 2*5 + 1*6 = 24 ; 2*4 + 1*5 = 13.
        self.assertEqual(fallback.stock_value, Decimal('60.00'))
        self.assertEqual(partial.stock_value, Decimal('24.00'))
        self.assertEqual(excess.stock_value, Decimal('13.00'))

        response = self.client.get('/api/inventory/products/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Decimal(str(response.data['stock_value'])), Decimal('97.00'))

        detail_response = self.client.get('/api/inventory/products/?ordering=id')
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        rows = detail_response.data.get('results', detail_response.data)
        detail_total = sum(
            (Decimal(str(row['stock_value'])) for row in rows),
            Decimal('0.00'),
        )
        self.assertEqual(detail_total, Decimal('97.00'))

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
        movement = StockMovement.objects.get(product=product)
        self.assertEqual(movement.movement_type, StockMovement.MovementType.IN)
        self.assertEqual(movement.quantity, 7)
        self.assertEqual(movement.stock_before, 0)
        self.assertEqual(movement.stock_after, 7)
        self.assertEqual(ProductCostLayer.active_quantity(product), 7)
        audit = AuditLog.objects.get(
            action=AuditLog.ActionType.CREATE,
            model_name='Product',
            object_id=product.pk,
        )
        self.assertEqual(audit.changes['after']['stock'], 7)
        self.assertEqual(audit.changes['import_line'], 2)

    def test_import_products_from_zip_with_image(self):
        image_buffer = BytesIO()
        Image.new('RGB', (2, 2), color='white').save(image_buffer, format='PNG')
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w') as archive:
            archive.writestr(
                'products.csv',
                'name,barcode,sale_price,stock\nProduit image,5555555555555,9.90,3\n',
            )
            archive.writestr('5555555555555.png', image_buffer.getvalue())

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
        self.assertEqual(response.data['images'], 1)
        product = Product.objects.get(barcode='5555555555555')
        self.addCleanup(product.image.delete, False)
        self.assertTrue(product.image.name.endswith('.png'))

    def test_import_rejects_fake_image_and_rolls_back(self):
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w') as archive:
            archive.writestr(
                'products.csv',
                'name,barcode,sale_price,stock\nProduit faux,5555555555556,9.90,3\n',
            )
            archive.writestr('5555555555556.png', b'not-an-image')

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {
                'file': SimpleUploadedFile(
                    'products.zip',
                    zip_buffer.getvalue(),
                    content_type='application/zip',
                )
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Product.objects.filter(barcode='5555555555556').exists())

    def test_import_invalid_row_is_all_or_nothing(self):
        upload = SimpleUploadedFile(
            'products.csv',
            (
                b'name,barcode,sale_price,stock\n'
                b'Valide,5555555555557,9.90,3\n'
                b'Invalide,5555555555558,abc,4\n'
            ),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            Product.objects.filter(
                barcode__in=['5555555555557', '5555555555558']
            ).exists()
        )

    def test_import_dry_run_does_not_write(self):
        upload = SimpleUploadedFile(
            'products.csv',
            b'name,barcode,sale_price,stock\nSimulation,5555555555559,9.90,3\n',
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload, 'dry_run': 'true'},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['dry_run'])
        self.assertEqual(response.data['would_create'], 1)
        self.assertFalse(Product.objects.filter(barcode='5555555555559').exists())

    def test_import_upsert_uses_movement_and_price_history(self):
        product = Product.objects.create(
            name='Avant import',
            barcode='5555555555560',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('4.00'),
            stock=2,
        )
        ProductCostLayer.create_layer(product, 2)
        upload = SimpleUploadedFile(
            'products.csv',
            (
                b'name,barcode,purchase_price,sale_price,stock\n'
                b'Apres import,5555555555560,3.00,6.00,5\n'
            ),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload, 'upsert': 'true'},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.name, 'Apres import')
        self.assertEqual(product.stock, 5)
        self.assertEqual(ProductCostLayer.active_quantity(product), 5)
        self.assertEqual(
            StockMovement.objects.get(product=product).movement_type,
            StockMovement.MovementType.ADJUST,
        )
        self.assertTrue(PriceHistory.objects.filter(product=product).exists())
        audit = AuditLog.objects.get(
            action=AuditLog.ActionType.UPDATE,
            model_name='Product',
            object_id=product.pk,
        )
        self.assertEqual(audit.changes['before']['stock'], 2)
        self.assertEqual(audit.changes['after']['stock'], 5)
        self.assertEqual(audit.changes['before']['name'], 'Avant import')
        self.assertEqual(audit.changes['after']['name'], 'Apres import')

    def test_import_upsert_preserves_old_cost_and_applies_current_sale_price(self):
        product = Product.objects.create(
            name='Ancien stock sans lot',
            barcode='5555555555562',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('4.00'),
            stock=3,
        )
        upload = SimpleUploadedFile(
            'products.csv',
            (
                b'name,barcode,purchase_price,sale_price\n'
                b'Ancien stock sans lot,5555555555562,9.00,12.00\n'
            ),
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload, 'upsert': 'true'},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        layer = product.cost_layers.get()
        self.assertEqual(product.purchase_price, Decimal('9.00'))
        self.assertEqual(product.sale_price_ht, Decimal('12.00'))
        self.assertEqual(layer.unit_cost, Decimal('2.00'))
        self.assertEqual(layer.sale_price, Decimal('12.00'))

    def test_corrupt_xlsx_is_reported_as_client_error(self):
        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {
                'file': SimpleUploadedFile(
                    'products.xlsx',
                    b'not-an-xlsx-file',
                    content_type=(
                        'application/vnd.openxmlformats-officedocument.'
                        'spreadsheetml.sheet'
                    ),
                )
            },
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sparse_import_upsert_preserves_fields_that_are_absent(self):
        category = Category.objects.create(name='Categorie preservee')
        supplier = Supplier.objects.create(name='Fournisseur preserve')
        product = Product.objects.create(
            name='Nom avant',
            barcode='5555555555561',
            description='Description preservee',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('4.00'),
            tva=Decimal('20.00'),
            stock=9,
            min_stock=3,
            category=category,
            supplier=supplier,
        )
        ProductCostLayer.create_layer(product, 9)
        upload = SimpleUploadedFile(
            'products.csv',
            b'name,barcode\nNom apres,5555555555561\n',
            content_type='text/csv',
        )

        response = self.client.post(
            '/api/inventory/products/import_excel/',
            {'file': upload, 'upsert': 'true'},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.name, 'Nom apres')
        self.assertEqual(product.description, 'Description preservee')
        self.assertEqual(product.purchase_price, Decimal('2.00'))
        self.assertEqual(product.sale_price_ht, Decimal('4.00'))
        self.assertEqual(product.tva, Decimal('20.00'))
        self.assertEqual(product.stock, 9)
        self.assertEqual(product.min_stock, 3)
        self.assertEqual(product.category, category)
        self.assertEqual(product.supplier, supplier)
        self.assertEqual(ProductCostLayer.active_quantity(product), 9)
        self.assertFalse(StockMovement.objects.filter(product=product).exists())

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

    def test_cashier_can_use_pos_catalog_without_inventory_permission(self):
        product = Product.objects.create(
            name='Produit caisse sécurisé',
            barcode='7000000000001',
            purchase_price=Decimal('4.00'),
            sale_price_ht=Decimal('9.00'),
            stock=3,
        )
        valid_layer = ProductCostLayer.create_layer(product, 3)
        ProductCostLayer.objects.filter(pk=valid_layer.pk).update(
            sale_price=Decimal('0.00'),
        )
        zero_price_product = Product.objects.create(
            name='Produit sans prix',
            barcode='7000000000099',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('0.00'),
            stock=2,
        )
        zero_price_layer = ProductCostLayer.create_layer(zero_price_product, 2)
        ProductCostLayer.objects.filter(pk=zero_price_layer.pk).update(
            sale_price=Decimal('9.00'),
        )
        cashier = User.objects.create_user(
            username='cashier-pos-only',
            password='cashier123',
            role='CASHIER',
            can_view_stock=False,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.get('/api/inventory/products/pos/?barcode=7000000000001')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        products = response.data.get('results', response.data)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0]['barcode'], product.barcode)
        for sensitive_field in (
            'purchase_price', 'profit_margin', 'profit_percentage',
            'stock_value', 'cost_layers',
        ):
            self.assertNotIn(sensitive_field, products[0])

        unfiltered_response = self.client.get('/api/inventory/products/pos/')
        unfiltered_products = unfiltered_response.data.get(
            'results', unfiltered_response.data
        )
        self.assertNotIn(
            zero_price_product.id,
            {item['id'] for item in unfiltered_products},
        )

    def test_global_stock_setting_grants_cashier_inventory_access(self):
        from core.models import AppSettings

        app_settings = AppSettings.get_settings()
        app_settings.cashier_can_view_stock = True
        app_settings.save(update_fields=['cashier_can_view_stock'])
        cashier = User.objects.create_user(
            username='cashier-global-inventory',
            password='cashier123',
            role='CASHIER',
            can_view_stock=False,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.get('/api/inventory/products/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_cashier_with_stock_permission_can_read_products(self):
        product = Product.objects.create(
            name='Produit inventaire sécurisé',
            barcode='7000000000002',
            purchase_price=Decimal('5.00'),
            sale_price_ht=Decimal('10.00'),
            stock=2,
        )
        ProductCostLayer.create_layer(product, 2)
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
        products = response.data.get('results', response.data)
        payload = next(item for item in products if item['id'] == product.id)
        for sensitive_field in (
            'purchase_price', 'profit_margin', 'profit_percentage',
            'stock_value', 'cost_layers',
        ):
            self.assertNotIn(sensitive_field, payload)

    def test_cashier_cannot_access_or_modify_inventory_cost_data(self):
        product = Product.objects.create(
            name='Produit coût admin',
            barcode='7000000000003',
            purchase_price=Decimal('6.00'),
            sale_price_ht=Decimal('12.00'),
            stock=2,
        )
        layer = ProductCostLayer.create_layer(product, 2)
        cashier = User.objects.create_user(
            username='cashier-stock-manager',
            password='cashier123',
            role='CASHIER',
            can_view_stock=True,
            can_manage_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        update_response = self.client.patch(
            f'/api/inventory/products/{product.id}/',
            {'purchase_price': '0.01'},
            format='json',
        )
        layer_response = self.client.get(
            f'/api/inventory/product-cost-layers/{layer.id}/'
        )
        stats_response = self.client.get('/api/inventory/products/stats/')

        self.assertEqual(update_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(layer_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(stats_response.status_code, status.HTTP_403_FORBIDDEN)
        product.refresh_from_db()
        self.assertEqual(product.purchase_price, Decimal('6.00'))

    def test_cashier_stock_manager_cannot_create_unvalued_initial_stock(self):
        cashier = User.objects.create_user(
            username='cashier-initial-stock',
            password='cashier123',
            role='CASHIER',
            can_manage_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post(
            '/api/inventory/products/',
            {
                'name': 'Stock initial interdit',
                'barcode': '7000000000010',
                'sale_price_ht': '12.00',
                'stock': 3,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('stock', response.data)
        self.assertFalse(Product.objects.filter(barcode='7000000000010').exists())

    def test_cashier_stock_manager_can_create_zero_stock_product(self):
        cashier = User.objects.create_user(
            username='cashier-zero-stock',
            password='cashier123',
            role='CASHIER',
            can_manage_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.post(
            '/api/inventory/products/',
            {
                'name': 'Produit vendeur sans stock',
                'barcode': '7000000000011',
                'sale_price_ht': '12.00',
                'stock': 0,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        product = Product.objects.get(barcode='7000000000011')
        self.assertEqual(product.stock, 0)
        self.assertFalse(StockMovement.objects.filter(product=product).exists())

    def test_cashier_supplier_response_hides_contact_details(self):
        Supplier.objects.create(
            name='Fournisseur privé',
            contact_name='Contact secret',
            email='secret@example.com',
            phone='0600000000',
            address='Adresse privée',
            notes='Note interne',
        )
        cashier = User.objects.create_user(
            username='cashier-supplier',
            password='cashier123',
            role='CASHIER',
            can_view_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        response = self.client.get('/api/inventory/suppliers/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        suppliers = response.data.get('results', response.data)
        for sensitive_field in ('contact_name', 'email', 'phone', 'address', 'notes'):
            self.assertNotIn(sensitive_field, suppliers[0])

    def test_cashier_supplier_search_cannot_probe_hidden_contact_fields(self):
        supplier = Supplier.objects.create(
            name='Fournisseur visible',
            email='needle-secret@example.com',
            phone='0611223344',
        )
        cashier = User.objects.create_user(
            username='cashier-supplier-search',
            password='cashier123',
            role='CASHIER',
            can_view_stock=True,
        )
        self.client.credentials()
        self.client.force_authenticate(user=cashier)

        hidden_search = self.client.get(
            '/api/inventory/suppliers/?search=needle-secret'
        )
        visible_search = self.client.get(
            '/api/inventory/suppliers/?search=Fournisseur%20visible'
        )

        self.assertEqual(hidden_search.status_code, status.HTTP_200_OK)
        self.assertEqual(visible_search.status_code, status.HTTP_200_OK)
        hidden_results = hidden_search.data.get('results', hidden_search.data)
        visible_results = visible_search.data.get('results', visible_search.data)
        self.assertEqual(hidden_results, [])
        self.assertIn(supplier.pk, {item['id'] for item in visible_results})

        self.client.force_authenticate(user=self.admin)
        admin_search = self.client.get(
            '/api/inventory/suppliers/?search=needle-secret'
        )
        admin_results = admin_search.data.get('results', admin_search.data)
        self.assertIn(supplier.pk, {item['id'] for item in admin_results})

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

    def test_purchase_order_create_rejects_duplicate_products_atomically(self):
        supplier = Supplier.objects.create(name='Fournisseur doublon')
        product = Product.objects.create(
            name='Produit doublon',
            barcode='7777777777778',
            sale_price_ht=Decimal('12.00'),
            stock=0,
        )

        response = self.client.post(
            '/api/inventory/purchase-orders/',
            {
                'supplier': supplier.id,
                'items': [
                    {'product': product.id, 'quantity': 2, 'unit_cost': '4.00'},
                    {'product': product.id, 'quantity': 3, 'unit_cost': '4.00'},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PurchaseOrder.objects.filter(supplier=supplier).exists())

    def test_purchase_order_over_receive_is_rejected_without_mutation(self):
        supplier = Supplier.objects.create(name='Fournisseur sur reception')
        product = Product.objects.create(
            name='Produit sur reception',
            barcode='7777777777779',
            sale_price_ht=Decimal('12.00'),
            stock=0,
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status=PurchaseOrder.OrderStatus.SENT,
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=5,
            unit_cost=Decimal('4.00'),
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {'items': [{'item_id': item.id, 'quantity': 6}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        item.refresh_from_db()
        product.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(item.received_quantity, 0)
        self.assertEqual(product.stock, 0)
        self.assertEqual(order.status, PurchaseOrder.OrderStatus.SENT)
        self.assertFalse(StockMovement.objects.filter(product=product).exists())

    def test_purchase_order_receipt_id_is_idempotent(self):
        supplier = Supplier.objects.create(name='Fournisseur idempotent')
        product = Product.objects.create(
            name='Produit reception idempotente',
            barcode='7777777777782',
            purchase_price=Decimal('4.00'),
            sale_price_ht=Decimal('12.00'),
            stock=0,
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status=PurchaseOrder.OrderStatus.SENT,
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=5,
            unit_cost=Decimal('4.00'),
        )
        payload = {
            'receipt_id': 'receipt-test-0001',
            'items': [{'item_id': item.id, 'quantity': 5}],
        }

        first = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            payload,
            format='json',
        )
        replay = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            payload,
            format='json',
        )
        conflict = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {
                'receipt_id': 'receipt-test-0001',
                'items': [{'item_id': item.id, 'quantity': 1}],
            },
            format='json',
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertTrue(replay.data['idempotent_replay'])
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        product.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(product.stock, 5)
        self.assertEqual(item.received_quantity, 5)
        self.assertEqual(StockMovement.objects.filter(product=product).count(), 1)

    def test_purchase_order_unknown_line_is_rejected_without_mutation(self):
        supplier = Supplier.objects.create(name='Fournisseur ligne inconnue')
        product = Product.objects.create(
            name='Produit ligne inconnue',
            barcode='7777777777780',
            sale_price_ht=Decimal('12.00'),
            stock=0,
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status=PurchaseOrder.OrderStatus.SENT,
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=5,
            unit_cost=Decimal('4.00'),
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {'items': [{'item_id': item.id + 1000, 'quantity': 1}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        item.refresh_from_db()
        product.refresh_from_db()
        self.assertEqual(item.received_quantity, 0)
        self.assertEqual(product.stock, 0)

    def test_partially_received_purchase_order_cannot_be_cancelled(self):
        supplier = Supplier.objects.create(name='Fournisseur annulation')
        product = Product.objects.create(
            name='Produit annulation',
            barcode='7777777777781',
            sale_price_ht=Decimal('12.00'),
            stock=1,
        )
        ProductCostLayer.create_layer(product, 1)
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status=PurchaseOrder.OrderStatus.PARTIALLY_RECEIVED,
            created_by=self.admin,
        )
        PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=5,
            received_quantity=1,
            unit_cost=Decimal('4.00'),
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/cancel/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        order.refresh_from_db()
        self.assertEqual(order.status, PurchaseOrder.OrderStatus.PARTIALLY_RECEIVED)

    def test_purchase_order_receive_keeps_current_price_without_explicit_change(self):
        supplier = Supplier.objects.create(name='Fournisseur prix')
        product = Product.objects.create(
            name='Produit prix',
            barcode='8888888888888',
            sale_price_ht=Decimal('12.00'),
            purchase_price=Decimal('4.00'),
            stock=0,
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status='SENT',
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=5,
            unit_cost=Decimal('5.00'),
            sale_price=Decimal('15.00'),
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {'items': [{'item_id': item.id, 'quantity': 5}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.purchase_price, Decimal('4.00'))
        self.assertEqual(product.sale_price_ht, Decimal('12.00'))
        self.assertEqual(product.price_ttc, Decimal('12.00'))
        self.assertEqual(
            ProductCostLayer.objects.get(product=product).sale_price,
            Decimal('12.00'),
        )
        self.assertEqual(
            response.data['results'][0]['sale_price_applied'],
            12.0,
        )
        self.assertEqual(response.data['results'][0]['updated_sale_price'], False)

    def test_purchase_order_receive_updates_one_price_for_old_and_new_stock(self):
        supplier = Supplier.objects.create(name='Fournisseur prix global')
        product = Product.objects.create(
            name='Produit prix global',
            barcode='8888888888889',
            sale_price_ht=Decimal('12.00'),
            purchase_price=Decimal('4.00'),
            stock=3,
        )
        old_layer = ProductCostLayer.create_layer(
            product,
            3,
            unit_cost=Decimal('4.00'),
            sale_price=Decimal('12.00'),
        )
        order = PurchaseOrder.objects.create(
            supplier=supplier,
            status='SENT',
            created_by=self.admin,
        )
        item = PurchaseOrderItem.objects.create(
            order=order,
            product=product,
            quantity=2,
            unit_cost=Decimal('5.00'),
            sale_price=Decimal('15.00'),
        )

        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.id}/receive/',
            {
                'receipt_id': 'uniform-sale-price-0001',
                'items': [{
                    'item_id': item.id,
                    'quantity': 2,
                    'new_sale_price': '15.00',
                    'update_sale_price': True,
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        old_layer.refresh_from_db()
        self.assertEqual(product.sale_price_ht, Decimal('15.00'))
        self.assertEqual(old_layer.unit_cost, Decimal('4.00'))
        self.assertEqual(
            set(ProductCostLayer.objects.filter(product=product).values_list(
                'sale_price', flat=True,
            )),
            {Decimal('15.00')},
        )
        self.assertEqual(response.data['results'][0]['sale_price_applied'], 15.0)
        self.assertTrue(response.data['results'][0]['updated_sale_price'])

    def test_inventory_count_lifecycle_is_atomic_and_audited(self):
        product = Product.objects.create(
            name='Produit inventaire',
            barcode='9999999999991',
            purchase_price=Decimal('3.00'),
            sale_price_ht=Decimal('7.00'),
            stock=10,
        )
        ProductCostLayer.create_layer(product, 10)
        create_response = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Inventaire test',
                'items': [{
                    'product': product.id,
                    'expected_quantity': 999,
                }],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        count = InventoryCount.objects.get(pk=create_response.data['id'])
        item = InventoryCountItem.objects.get(count=count)
        self.assertEqual(item.expected_quantity, 10)
        self.assertEqual(count.status, InventoryCount.CountStatus.IN_PROGRESS)

        incomplete_response = self.client.post(
            f'/api/inventory/counts/{count.id}/complete/', {}, format='json'
        )
        self.assertEqual(incomplete_response.status_code, status.HTTP_400_BAD_REQUEST)
        count.refresh_from_db()
        self.assertEqual(count.status, InventoryCount.CountStatus.IN_PROGRESS)

        update_response = self.client.post(
            f'/api/inventory/counts/{count.id}/update_counts/',
            {'items': [{'id': item.id, 'counted_quantity': 7}]},
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        complete_response = self.client.post(
            f'/api/inventory/counts/{count.id}/complete/', {}, format='json'
        )
        self.assertEqual(complete_response.status_code, status.HTTP_200_OK)
        validate_response = self.client.post(
            f'/api/inventory/counts/{count.id}/validate/', {}, format='json'
        )
        self.assertEqual(validate_response.status_code, status.HTTP_200_OK)

        count.refresh_from_db()
        product.refresh_from_db()
        movement = StockMovement.objects.get(
            product=product,
            movement_type=StockMovement.MovementType.ADJUST,
        )
        self.assertEqual(count.status, InventoryCount.CountStatus.VALIDATED)
        self.assertEqual(count.validated_by, self.admin)
        self.assertEqual(product.stock, 7)
        self.assertEqual(movement.stock_before, 10)
        self.assertEqual(movement.stock_after, 7)
        self.assertEqual(ProductCostLayer.active_quantity(product), 7)

    def test_inventory_count_auto_validate_requires_every_count(self):
        product = Product.objects.create(
            name='Produit auto inventaire',
            barcode='9999999999992',
            sale_price_ht=Decimal('7.00'),
            stock=4,
        )
        response = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Inventaire auto invalide',
                'auto_validate': True,
                'items': [{'product': product.id}],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(InventoryCount.objects.filter(name='Inventaire auto invalide').exists())

    def test_overlapping_inventory_counts_are_rejected(self):
        product = Product.objects.create(
            name='Produit comptage exclusif',
            barcode='9999999999995',
            sale_price_ht=Decimal('7.00'),
            stock=4,
        )
        first = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Premier comptage',
                'items': [{'product': product.id}],
            },
            format='json',
        )
        second = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Deuxieme comptage',
                'items': [{'product': product.id}],
            },
            format='json',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            InventoryCount.objects.filter(items__product=product).count(),
            1,
        )

    def test_product_delete_is_a_soft_deactivation(self):
        product = Product.objects.create(
            name='Produit a desactiver',
            barcode='9999999999996',
            sale_price_ht=Decimal('7.00'),
            stock=0,
        )

        response = self.client.delete(
            f'/api/inventory/products/{product.id}/'
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        product.refresh_from_db()
        self.assertFalse(product.active)
        audit = AuditLog.objects.get(
            action=AuditLog.ActionType.DELETE,
            model_name='Product',
            object_id=product.pk,
        )
        self.assertTrue(audit.changes['soft_deactivation'])
        self.assertTrue(audit.changes['before']['active'])
        self.assertFalse(audit.changes['after']['active'])

    def test_inventory_count_auto_validate_adjusts_through_movement(self):
        product = Product.objects.create(
            name='Produit auto valide',
            barcode='9999999999993',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('7.00'),
            stock=4,
        )
        ProductCostLayer.create_layer(product, 4)
        response = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Inventaire auto valide',
                'auto_validate': True,
                'items': [{
                    'product': product.id,
                    'counted_quantity': 6,
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        count = InventoryCount.objects.get(pk=response.data['id'])
        product.refresh_from_db()
        self.assertEqual(count.status, InventoryCount.CountStatus.VALIDATED)
        self.assertEqual(count.validated_by, self.admin)
        self.assertEqual(product.stock, 6)
        self.assertEqual(ProductCostLayer.active_quantity(product), 6)
        self.assertTrue(
            StockMovement.objects.filter(
                product=product,
                movement_type=StockMovement.MovementType.ADJUST,
            ).exists()
        )

    def test_inventory_count_preserves_movements_after_snapshot(self):
        product = Product.objects.create(
            name='Produit inventaire concurrent',
            barcode='9999999999994',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('7.00'),
            stock=10,
        )
        ProductCostLayer.create_layer(product, 10)
        create_response = self.client.post(
            '/api/inventory/counts/',
            {
                'name': 'Inventaire avec vente intercalee',
                'items': [{
                    'product': product.id,
                    'counted_quantity': 8,
                }],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        count = InventoryCount.objects.get(pk=create_response.data['id'])

        StockMovement.objects.create(
            product=product,
            movement_type=StockMovement.MovementType.OUT,
            quantity=2,
            created_by=self.admin,
        )
        self.client.post(
            f'/api/inventory/counts/{count.id}/complete/', {}, format='json'
        )
        response = self.client.post(
            f'/api/inventory/counts/{count.id}/validate/', {}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        product.refresh_from_db()
        self.assertEqual(product.stock, 6)
        self.assertEqual(ProductCostLayer.active_quantity(product), 6)
        self.assertEqual(response.data['adjustments'][0]['difference'], -2)
        self.assertEqual(
            response.data['adjustments'][0]['stock_before_validation'],
            8,
        )


class SupplierAPITest(APITestCase):
    """Tests API pour les fournisseurs"""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        self.client.force_authenticate(user=self.admin)

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
