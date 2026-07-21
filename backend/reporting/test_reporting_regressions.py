from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User
from inventory.models import Product
from sales.models import Return, ReturnItem, Sale, SaleItem

from .tasks import get_report_data


class ProductReportRoundingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='report-rounding-user',
            password='Strong-Report-Rounding-2026!',
            role=User.Role.ADMIN,
        )
        self.products = [
            Product.objects.create(
                name=name,
                barcode=f'REPORT-CENT-{index}',
                purchase_price=Decimal('0.00'),
                sale_price_ht=Decimal('0.01'),
                tva=Decimal('0.00'),
                stock=0,
            )
            for index, name in enumerate(('Produit A', 'Produit B'), start=1)
        ]

    def _fractional_sale(self):
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('0.01'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('0.01'),
            discount_amount=Decimal('0.01'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        items = []
        for index, product in enumerate(self.products):
            items.append(SaleItem.objects.create(
                sale=sale,
                product=product,
                product_name=product.name,
                quantity=1,
                unit_price_ht=Decimal('0.01'),
                total_price_ht=Decimal('0.01'),
                tva_rate=Decimal('0.00'),
                unit_purchase_price=Decimal('0.01') if index == 0 else Decimal('0.00'),
                total_purchase_cost=Decimal('0.01') if index == 0 else Decimal('0.00'),
            ))
        return sale, items

    def _assert_product_totals_reconcile(self, report):
        rows = report['items_sold']
        revenues = [Decimal(str(row['revenue'])) for row in rows]
        costs = [Decimal(str(row['cost'])) for row in rows]
        profits = [Decimal(str(row['profit'])) for row in rows]
        for amount in revenues + costs + profits:
            self.assertEqual(amount, amount.quantize(Decimal('0.01')))
        self.assertEqual(sum(revenues), Decimal(str(report['total_revenue'])))
        self.assertEqual(sum(costs), Decimal(str(report['net_cost'])))
        self.assertEqual(sum(profits), Decimal(str(report['gross_margin'])))

    def test_sale_residual_is_deterministic_and_reconciles_to_accounting_cent(self):
        self._fractional_sale()
        report = get_report_data(timezone.localdate(), timezone.localdate())

        self._assert_product_totals_reconcile(report)
        by_name = {row['name']: Decimal(str(row['revenue'])) for row in report['items_sold']}
        self.assertEqual(by_name, {
            'Produit A': Decimal('0.01'),
            'Produit B': Decimal('0.00'),
        })

    def test_return_residual_uses_same_order_and_leaves_no_fractional_cent(self):
        sale, items = self._fractional_sale()
        returned = Return.objects.create(
            sale=sale,
            status=Return.ReturnStatus.COMPLETED,
            reason='Retour arrondi multi-produit',
            refund_amount=Decimal('0.01'),
            completed_at=timezone.now(),
        )
        for item in items:
            ReturnItem.objects.create(
                return_order=returned,
                sale_item=item,
                quantity=1,
                restock=True,
            )

        report = get_report_data(timezone.localdate(), timezone.localdate())

        self._assert_product_totals_reconcile(report)
        self.assertTrue(all(
            Decimal(str(row['revenue'])) == Decimal('0.00')
            for row in report['items_sold']
        ))


class StatsReportingRegressionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='stats-regression-admin',
            password='Strong-Stats-Regression-2026!',
            role=User.Role.ADMIN,
        )
        self.client.force_authenticate(self.admin)

    def test_replenishment_alerts_exclude_inactive_products(self):
        active_out = Product.objects.create(
            name='Actif rupture', barcode='ACTIVE-OUT',
            purchase_price=Decimal('1.00'), sale_price_ht=Decimal('2.00'),
            stock=0, min_stock=2, active=True,
        )
        active_low = Product.objects.create(
            name='Actif faible', barcode='ACTIVE-LOW',
            purchase_price=Decimal('1.00'), sale_price_ht=Decimal('2.00'),
            stock=1, min_stock=2, active=True,
        )
        inactive = Product.objects.create(
            name='Archive rupture', barcode='INACTIVE-OUT',
            purchase_price=Decimal('1.00'), sale_price_ht=Decimal('2.00'),
            stock=0, min_stock=2, active=False,
        )

        response = self.client.get('/api/reporting/stats/')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['to_replenish_count'], 2)
        self.assertEqual(response.data['out_of_stock_count'], 1)
        self.assertEqual(response.data['low_stock_only_count'], 1)
        ids = {row['id'] for row in response.data['low_stock']}
        self.assertEqual(ids, {active_out.pk, active_low.pk})
        self.assertNotIn(inactive.pk, ids)

    def test_top_products_reconcile_discounts_returns_cost_and_margin(self):
        product = Product.objects.create(
            name='Livre parcours complet', barcode='TOP-NET-WORKFLOW',
            purchase_price=Decimal('12.00'), sale_price_ht=Decimal('25.00'),
            stock=0, min_stock=0,
        )

        def create_sale(total_ttc, discount_amount, lines):
            gross = sum(
                (price * quantity for quantity, price, _cost in lines),
                Decimal('0.00'),
            )
            sale = Sale.objects.create(
                user=self.admin,
                total_ht=gross,
                total_tva=Decimal('0.00'),
                total_ttc=total_ttc,
                discount_amount=discount_amount,
                payment_method=Sale.PaymentMethod.CASH,
            )
            created_items = []
            for quantity, price, unit_cost in lines:
                created_items.append(SaleItem.objects.create(
                    sale=sale,
                    product=product,
                    product_name=product.name,
                    quantity=quantity,
                    unit_price_ht=price,
                    total_price_ht=price * quantity,
                    tva_rate=Decimal('0.00'),
                    unit_purchase_price=unit_cost,
                    total_purchase_cost=unit_cost * quantity,
                ))
            return sale, created_items

        create_sale(
            Decimal('60.00'), Decimal('0.00'),
            [(3, Decimal('20.00'), Decimal('10.00'))],
        )
        create_sale(
            Decimal('36.00'), Decimal('4.00'),
            [(2, Decimal('20.00'), Decimal('10.00'))],
        )
        create_sale(
            Decimal('150.00'), Decimal('0.00'),
            [
                (5, Decimal('20.00'), Decimal('10.00')),
                (2, Decimal('25.00'), Decimal('12.00')),
            ],
        )
        discounted_sale, discounted_items = create_sale(
            Decimal('95.00'), Decimal('5.00'),
            [(4, Decimal('25.00'), Decimal('12.00'))],
        )
        returned = Return.objects.create(
            sale=discounted_sale,
            status=Return.ReturnStatus.COMPLETED,
            reason='Retour apres remise',
            refund_amount=Decimal('23.75'),
            completed_at=timezone.now(),
        )
        ReturnItem.objects.create(
            return_order=returned,
            sale_item=discounted_items[0],
            quantity=1,
            restock=True,
        )

        response = self.client.get('/api/reporting/stats/?days=7')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            Decimal(str(response.data['month']['revenue'])),
            Decimal('317.25'),
        )
        self.assertEqual(len(response.data['top_products']), 1)
        top_product = response.data['top_products'][0]
        self.assertEqual(top_product['product__name'], product.name)
        self.assertEqual(top_product['total_qty'], 15)
        self.assertEqual(
            Decimal(str(top_product['total_revenue'])), Decimal('317.25'),
        )
        self.assertEqual(
            Decimal(str(top_product['total_cost'])), Decimal('160.00'),
        )
        self.assertEqual(
            Decimal(str(top_product['total_margin'])), Decimal('157.25'),
        )

    def test_long_period_keeps_week_with_only_completed_return(self):
        product = Product.objects.create(
            name='Produit retour seul', barcode='RETURN-ONLY-WEEK',
            purchase_price=Decimal('5.00'), sale_price_ht=Decimal('10.00'),
            stock=0, min_stock=0,
        )
        sale = Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('10.00'), total_tva=Decimal('0.00'),
            total_ttc=Decimal('10.00'), payment_method=Sale.PaymentMethod.CASH,
        )
        item = SaleItem.objects.create(
            sale=sale, product=product, product_name=product.name,
            quantity=1, unit_price_ht=Decimal('10.00'),
            total_price_ht=Decimal('10.00'), tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('5.00'), total_purchase_cost=Decimal('5.00'),
        )
        Sale.objects.filter(pk=sale.pk).update(
            created_at=timezone.now() - timedelta(days=120),
        )
        completed_at = timezone.now() - timedelta(days=14)
        returned = Return.objects.create(
            sale=sale,
            status=Return.ReturnStatus.COMPLETED,
            reason='Retour sans vente dans la semaine',
            refund_amount=Decimal('10.00'),
            completed_at=completed_at,
        )
        ReturnItem.objects.create(
            return_order=returned,
            sale_item=item,
            quantity=1,
            restock=True,
        )
        expected_week = (
            timezone.localtime(completed_at).date()
            - timedelta(days=timezone.localtime(completed_at).date().weekday())
        )

        response = self.client.get('/api/reporting/stats/?days=90')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        week = next(
            row for row in response.data['revenue_7d']
            if row['date'] == expected_week.isoformat()
        )
        self.assertEqual(Decimal(str(week['revenue'])), Decimal('-10.00'))
        self.assertEqual(week['count'], 0)
        self.assertEqual(week['returns_count'], 1)
