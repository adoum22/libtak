from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User
from inventory.models import Product, StockMovement
from inventory.serializers import MAX_BULK_STOCK_ITEMS


class BulkStockInSecurityTest(APITestCase):
    endpoint = '/api/inventory/stock-movements/bulk_stock_in/'

    def setUp(self):
        self.admin = User.objects.create_user(
            username='bulk-stock-admin',
            password='A-long-test-passphrase-2026!',
            role=User.Role.ADMIN,
        )
        self.client.force_authenticate(self.admin)
        self.product = Product.objects.create(
            name='Bulk stock product',
            barcode='bulk-security-001',
            purchase_price=Decimal('2.00'),
            sale_price_ht=Decimal('3.00'),
            stock=5,
        )

    def item(self, **overrides):
        data = {'product': self.product.pk, 'quantity': 2}
        data.update(overrides)
        return data

    def test_non_list_and_non_object_items_return_400_not_500(self):
        payloads = (
            {'items': 'not-a-list'},
            {'items': [None]},
            {'items': ['not-an-object']},
            {'items': []},
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                response = self.client.post(self.endpoint, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StockMovement.objects.exists())

    def test_batch_size_is_bounded(self):
        payload = {
            'items': [self.item() for _ in range(MAX_BULK_STOCK_ITEMS + 1)]
        }
        response = self.client.post(self.endpoint, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StockMovement.objects.exists())

    def test_invalid_member_prevents_all_partial_writes(self):
        response = self.client.post(
            self.endpoint,
            {'items': [self.item(), self.item(product=99999999)]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StockMovement.objects.exists())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

    def test_valid_batch_is_created(self):
        response = self.client.post(
            self.endpoint,
            {'items': [self.item(quantity=3)]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_success'], 1)
        self.assertEqual(response.data['total_errors'], 0)
        self.assertEqual(StockMovement.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 8)
