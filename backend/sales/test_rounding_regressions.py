from decimal import Decimal

from django.db.models import Sum
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from core.models import User
from inventory.models import Product

from .models import Discount, Return, Sale, SaleItem


class DiscountApplyRoundingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='rounding-admin',
            password='pwd',
            role=User.Role.ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_apply_quantizes_discount_and_total_half_up_to_cents(self):
        Discount.objects.create(
            name='Tie at half a cent',
            code='HALFCENT',
            discount_type=Discount.DiscountType.PERCENTAGE,
            value=Decimal('12.50'),
        )

        response = self.client.post(
            '/api/sales/discounts/apply/',
            {'code': 'HALFCENT', 'subtotal': '0.20'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['discount_amount'], Decimal('0.03'))
        self.assertEqual(response.data['new_total'], Decimal('0.17'))
        self.assertEqual(response.data['discount_amount'].as_tuple().exponent, -2)
        self.assertEqual(response.data['new_total'].as_tuple().exponent, -2)


class DiscountedPartialReturnRoundingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='return-rounding-admin',
            password='pwd',
            role=User.Role.ADMIN,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        product = Product.objects.create(
            name='Article divisible',
            barcode='RETURN-ROUNDING',
            purchase_price=Decimal('0.25'),
            sale_price_ht=Decimal('1.00'),
            stock=0,
        )
        self.sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('2.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('2.00'),
            discount_amount=Decimal('1.00'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        self.sale_item = SaleItem.objects.create(
            sale=self.sale,
            product=product,
            product_name=product.name,
            quantity=3,
            unit_price_ht=Decimal('1.00'),
            total_price_ht=Decimal('3.00'),
            tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('0.25'),
            total_purchase_cost=Decimal('0.75'),
        )

    def _create_and_complete_one_unit_return(self):
        created = self.client.post(
            '/api/sales/returns/',
            {
                'sale': self.sale.id,
                'reason': 'Retour fractionne',
                'items': [{
                    'sale_item': self.sale_item.id,
                    'quantity': 1,
                    'restock': False,
                }],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        return_id = created.data['id']
        approved = self.client.post(f'/api/sales/returns/{return_id}/approve/')
        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.data)
        completed = self.client.post(f'/api/sales/returns/{return_id}/complete/')
        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        return Decimal(str(created.data['refund_amount']))

    def test_split_refunds_allocate_rounding_residue_to_exact_sale_total(self):
        refunds = [self._create_and_complete_one_unit_return() for _ in range(3)]

        self.assertEqual(refunds, [
            Decimal('0.67'),
            Decimal('0.66'),
            Decimal('0.67'),
        ])
        self.assertTrue(all(amount >= 0 for amount in refunds))
        self.assertTrue(all(
            sum(refunds[:index], Decimal('0.00')) <= self.sale.total_ttc
            for index in range(1, len(refunds) + 1)
        ))
        self.assertEqual(sum(refunds, Decimal('0.00')), self.sale.total_ttc)
        self.assertEqual(
            Return.objects.filter(
                sale=self.sale,
                status=Return.ReturnStatus.COMPLETED,
            ).aggregate(total=Sum('refund_amount'))['total'],
            self.sale.total_ttc,
        )
