from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User
from inventory.models import Product
from sales.models import Return, Sale


class SaleIdempotencyOwnershipTests(APITestCase):
    def setUp(self):
        self.first_cashier = User.objects.create_user(
            username='idempotency-cashier-one',
            password='Strong-Idempotency-One-2026!',
            role=User.Role.CASHIER,
        )
        self.second_cashier = User.objects.create_user(
            username='idempotency-cashier-two',
            password='Strong-Idempotency-Two-2026!',
            role=User.Role.CASHIER,
        )
        self.product = Product.objects.create(
            name='Produit isolation idempotence',
            barcode='IDEMPOTENCY-ISOLATION-001',
            purchase_price=Decimal('4.00'),
            sale_price_ht=Decimal('10.00'),
            stock=5,
        )
        self.payload = {
            'items': [{'product_id': self.product.pk, 'quantity': 1}],
            'payment_method': Sale.PaymentMethod.CASH,
            'amount_received': '10.00',
            'expected_total': '10.00',
            'idempotency_key': 'sale-owner-isolation-0001',
        }

    def test_idempotency_key_never_replays_another_cashiers_sale(self):
        self.client.force_authenticate(self.first_cashier)
        first = self.client.post('/api/sales/sales/', self.payload, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)

        self.client.force_authenticate(self.second_cashier)
        attempted_replay = self.client.post(
            '/api/sales/sales/',
            self.payload,
            format='json',
        )

        self.assertEqual(attempted_replay.status_code, status.HTTP_409_CONFLICT)
        self.assertNotIn('id', attempted_replay.data)
        self.assertEqual(Sale.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 4)


class ReturnIdempotencyOwnershipTests(APITestCase):
    def setUp(self):
        self.first_admin = User.objects.create_user(
            username='return-admin-one',
            password='Strong-Return-One-2026!',
            role=User.Role.ADMIN,
        )
        self.second_admin = User.objects.create_user(
            username='return-admin-two',
            password='Strong-Return-Two-2026!',
            role=User.Role.ADMIN,
        )
        product = Product.objects.create(
            name='Produit retour isolation',
            barcode='RETURN-IDEMPOTENCY-001',
            purchase_price=Decimal('4.00'),
            sale_price_ht=Decimal('10.00'),
            stock=2,
        )
        self.client.force_authenticate(self.first_admin)
        sale_response = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': product.pk, 'quantity': 1}],
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '10.00',
                'expected_total': '10.00',
            },
            format='json',
        )
        self.assertEqual(sale_response.status_code, status.HTTP_201_CREATED)
        sale_item = Sale.objects.get(pk=sale_response.data['id']).items.get()
        self.payload = {
            'sale': sale_response.data['id'],
            'reason': 'Retour pour isolation de la cle',
            'items': [{
                'sale_item': sale_item.pk,
                'quantity': 1,
                'restock': True,
            }],
            'idempotency_key': 'return-owner-isolation-0001',
        }

    def test_idempotency_key_never_replays_another_admins_return(self):
        self.client.force_authenticate(self.first_admin)
        first = self.client.post('/api/sales/returns/', self.payload, format='json')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)

        self.client.force_authenticate(self.second_admin)
        attempted_replay = self.client.post(
            '/api/sales/returns/',
            self.payload,
            format='json',
        )

        self.assertEqual(attempted_replay.status_code, status.HTTP_409_CONFLICT)
        self.assertNotIn('id', attempted_replay.data)
        self.assertEqual(Return.objects.count(), 1)
