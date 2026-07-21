from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import serializers, status
from decimal import Decimal

from inventory.models import Product, ProductCostLayer, StockMovement
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
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }
        response = self.client.post('/api/sales/sales/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Vérifier décrémentation stock
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 98)  # 100 - 2

    def test_product_without_positive_sale_price_cannot_be_sold(self):
        ProductCostLayer.objects.filter(product=self.product).delete()
        self.product.sale_price_ht = Decimal('0.00')
        self.product.stock = 3
        self.product.save(update_fields=['sale_price_ht', 'stock'])
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('1.00'),
            sale_price=Decimal('0.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )

        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CASH',
            'amount_received': '10.00',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('prix de vente', str(response.data).lower())
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 3)
        self.assertFalse(Sale.objects.exists())

    def test_sale_consumes_purchase_cost_layers_fifo(self):
        ProductCostLayer.objects.filter(product=self.product).delete()
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('1.00'),
            initial_quantity=3,
            remaining_quantity=3,
        )
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('1.10'),
            initial_quantity=5,
            remaining_quantity=5,
        )
        self.product.purchase_price = Decimal('1.10')
        self.product.stock = 8
        self.product.save(update_fields=['purchase_price', 'stock'])

        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 5}],
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        sale = Sale.objects.get(id=response.data['id'])
        self.assertEqual(
            sum(item.total_purchase_cost for item in sale.items.all()),
            Decimal('5.20'),
        )
        self.assertEqual(
            list(ProductCostLayer.objects.filter(product=self.product).values_list('remaining_quantity', flat=True)),
            [0, 3],
        )

    def test_sale_uses_current_price_across_fifo_cost_layers_and_price_changes(self):
        ProductCostLayer.objects.filter(product=self.product).delete()
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('6.00'),
            sale_price=Decimal('10.00'),
            initial_quantity=2,
            remaining_quantity=2,
        )
        ProductCostLayer.objects.create(
            product=self.product,
            unit_cost=Decimal('7.00'),
            sale_price=Decimal('12.00'),
            initial_quantity=5,
            remaining_quantity=5,
        )
        self.product.stock = 7
        self.product.sale_price_ht = Decimal('13.00')
        self.product.save(update_fields=['stock', 'sale_price_ht'])

        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 4}],
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        sale = Sale.objects.get(id=response.data['id'])
        self.assertEqual(sale.total_ttc, Decimal('52.00'))
        self.assertEqual(
            list(sale.items.order_by('id').values_list(
                'quantity', 'unit_price_ht', 'total_purchase_cost',
            )),
            [
                (2, Decimal('13.00'), Decimal('12.00')),
                (2, Decimal('13.00'), Decimal('14.00')),
            ],
        )

        # Une baisse s'applique aussitot au reliquat du meme lot.
        self.product.refresh_from_db()
        self.product.sale_price_ht = Decimal('8.00')
        self.product.save(update_fields=['sale_price_ht'])
        lower_price_response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 2}],
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }, format='json')

        self.assertEqual(lower_price_response.status_code, status.HTTP_201_CREATED)
        lower_price_sale = Sale.objects.get(id=lower_price_response.data['id'])
        self.assertEqual(lower_price_sale.total_ttc, Decimal('16.00'))
        self.assertEqual(
            lower_price_sale.items.get().total_purchase_cost,
            Decimal('14.00'),
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)

    def test_cashier_cannot_create_sale_with_direct_discount(self):
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 2}
            ],
            'discount_amount': '5.00',
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }
        response = self.client.post('/api/sales/sales/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('discount_amount', response.data)

    def test_discount_cannot_exceed_sale_total(self):
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 1}
            ],
            'discount_amount': '99.00',
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }
        response = self.client.post('/api/sales/sales/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_inactive_product_is_rejected(self):
        self.product.active = False
        self.product.save(update_fields=['active'])

        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 100)

    def test_duplicate_sale_items_are_aggregated_for_stock_check(self):
        data = {
            'items': [
                {'product_id': self.product.id, 'quantity': 2},
                {'product_id': self.product.id, 'quantity': 3},
            ],
            'payment_method': 'CASH',
            'amount_received': '1000.00',
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
            'payment_method': 'CASH',
            'amount_received': '1000.00',
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

    def test_cash_sale_requires_amount_received(self):
        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CASH',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('amount_received', response.data)

    def test_sale_is_idempotent_and_creates_one_stock_movement(self):
        payload = {
            'items': [{'product_id': self.product.id, 'quantity': 2}],
            'payment_method': 'CASH',
            'amount_received': '20.00',
            'expected_total': '20.00',
            'idempotency_key': 'sale-test-idempotency-001',
        }
        first = self.client.post('/api/sales/sales/', payload, format='json')
        second = self.client.post('/api/sales/sales/', payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data['id'], second.data['id'])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 98)
        self.assertEqual(
            StockMovement.objects.filter(
                product=self.product,
                movement_type=StockMovement.MovementType.OUT,
            ).count(),
            1,
        )

        changed = {**payload, 'items': [
            {'product_id': self.product.id, 'quantity': 3},
        ]}
        conflict = self.client.post('/api/sales/sales/', changed, format='json')
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)

    def test_expected_total_mismatch_rolls_back_stock(self):
        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CASH',
            'amount_received': '10.00',
            'expected_total': '9.00',
            'idempotency_key': 'sale-price-check-001',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('server_total', response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 100)

    def test_discount_code_is_computed_and_consumed_server_side(self):
        discount = Discount.objects.create(
            name='Promotion serveur',
            code='SERVER10',
            discount_type=Discount.DiscountType.PERCENTAGE,
            value=Decimal('10.00'),
            active=True,
        )
        response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CASH',
            'amount_received': '10.00',
            'discount_code': 'server10',
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Decimal(response.data['total_ttc']), Decimal('9.00'))
        discount.refresh_from_db()
        self.assertEqual(discount.uses_count, 1)


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

    def test_discount_rejects_invalid_financial_values(self):
        too_large = self.client.post('/api/sales/discounts/', {
            'name': 'Invalide',
            'code': 'INVALID-PERCENT',
            'discount_type': 'PERCENTAGE',
            'value': '101.00',
            'min_purchase': '-1.00',
        })
        self.assertEqual(too_large.status_code, status.HTTP_400_BAD_REQUEST)

        Discount.objects.create(
            name='Valide',
            code='VALID10',
            discount_type=Discount.DiscountType.PERCENTAGE,
            value=Decimal('10.00'),
        )
        negative_subtotal = self.client.post('/api/sales/discounts/apply/', {
            'code': 'VALID10',
            'subtotal': '-10.00',
        })
        self.assertEqual(negative_subtotal.status_code, status.HTTP_400_BAD_REQUEST)

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
            'payment_method': 'CASH',
            'amount_received': '1000.00',
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

        # Une demande en attente n'a aucun effet sur le stock.
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before)

        approve = self.client.post(
            f"/api/sales/returns/{response.data['id']}/approve/",
            {},
            format='json',
        )
        self.assertEqual(approve.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before + 2)

    def test_return_refund_uses_discounted_sale_price(self):
        sale_response = self.client.post('/api/sales/sales/', {
            'items': [{'product_id': self.product.id, 'quantity': 2}],
            'discount_amount': '4.00',
            'payment_method': 'CASH',
            'amount_received': '1000.00',
        }, format='json')
        discounted_sale = Sale.objects.get(id=sale_response.data['id'])
        discounted_item = discounted_sale.items.first()

        # Le prix catalogue peut changer apres la vente sans recalculer le
        # remboursement historique.
        self.product.sale_price_ht = Decimal('15.00')
        self.product.save(update_fields=['sale_price_ht'])

        response = self.client.post('/api/sales/returns/', {
            'sale': discounted_sale.id,
            'reason': 'Retour avec reduction',
            'items': [{'sale_item': discounted_item.id, 'quantity': 1}]
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            Decimal(str(response.data['refund_amount'])),
            Decimal('8.00'),
        )
        approve = self.client.post(
            f"/api/sales/returns/{response.data['id']}/approve/",
            {},
            format='json',
        )
        self.assertEqual(approve.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(ProductCostLayer.objects.filter(
                product=self.product,
                remaining_quantity__gt=0,
            ).values_list('sale_price', flat=True)),
            {Decimal('15.00')},
        )

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
            'payment_method': 'CASH',
            'amount_received': '1000.00',
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

    def test_duplicate_return_lines_are_aggregated_before_validation(self):
        response = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Doublon dans le formulaire',
            'items': [
                {'sale_item': self.sale_item.id, 'quantity': 3},
                {'sale_item': self.sale_item.id, 'quantity': 3},
            ],
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_has_no_stock_effect_and_status_is_not_writable(self):
        self.product.refresh_from_db()
        stock_before = self.product.stock
        created = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'status': Return.ReturnStatus.COMPLETED,
            'reason': 'Refus',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 1}],
        }, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data['status'], Return.ReturnStatus.PENDING)

        rejected = self.client.post(
            f"/api/sales/returns/{created.data['id']}/reject/",
            {},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before)

    def test_approve_is_atomic_and_cannot_restore_twice(self):
        self.product.refresh_from_db()
        stock_before = self.product.stock
        created = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Double approbation',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 2}],
        }, format='json')
        url = f"/api/sales/returns/{created.data['id']}/approve/"
        first = self.client.post(url, {}, format='json')
        second = self.client.post(url, {}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before + 2)

    def test_non_restockable_return_does_not_increase_inventory(self):
        self.product.refresh_from_db()
        stock_before = self.product.stock
        created = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Article endommage',
            'items': [{
                'sale_item': self.sale_item.id,
                'quantity': 1,
                'restock': False,
            }],
        }, format='json')
        approved = self.client.post(
            f"/api/sales/returns/{created.data['id']}/approve/",
            {},
            format='json',
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_before)

    def test_complete_records_refund_time_and_method(self):
        created = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Remboursement carte',
            'refund_method': Sale.PaymentMethod.CARD,
            'items': [{'sale_item': self.sale_item.id, 'quantity': 1}],
        }, format='json')
        return_id = created.data['id']
        self.client.post(f'/api/sales/returns/{return_id}/approve/', {})
        completed = self.client.post(
            f'/api/sales/returns/{return_id}/complete/', {},
        )
        self.assertEqual(completed.status_code, status.HTTP_200_OK)
        self.assertEqual(completed.data['status'], Return.ReturnStatus.COMPLETED)
        self.assertEqual(completed.data['refund_method'], Sale.PaymentMethod.CARD)
        self.assertIsNotNone(completed.data['completed_at'])

    def test_return_collection_disallows_update_and_delete(self):
        created = self.client.post('/api/sales/returns/', {
            'sale': self.sale.id,
            'reason': 'Immuable',
            'items': [{'sale_item': self.sale_item.id, 'quantity': 1}],
        }, format='json')
        url = f"/api/sales/returns/{created.data['id']}/"
        self.assertEqual(
            self.client.patch(url, {'status': 'COMPLETED'}).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
        self.assertEqual(
            self.client.delete(url).status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )
