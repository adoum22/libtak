from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.test import TestCase
from django.utils import timezone

from core.models import User
from inventory.models import Product
from sales.models import Sale, SaleItem

from .models import Expense, ExpenseCategory, MonthlyAccounting
from .views import PeriodSummaryView, sales_margin_analytics


class SalesMarginAllocationRoundingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='margin-rounding-admin',
            password='pwd',
            role=User.Role.ADMIN,
        )

    def test_product_breakdown_allocates_entire_discount_residue(self):
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('0.02'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('0.02'),
            discount_amount=Decimal('0.01'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        for index in range(3):
            product = Product.objects.create(
                name=f'Produit {index}',
                barcode=f'MARGIN-ROUNDING-{index}',
                purchase_price=Decimal('0.00'),
                sale_price_ht=Decimal('0.01'),
                stock=0,
            )
            SaleItem.objects.create(
                sale=sale,
                product=product,
                product_name=product.name,
                quantity=1,
                unit_price_ht=Decimal('0.01'),
                total_price_ht=Decimal('0.01'),
                tva_rate=Decimal('0.00'),
                unit_purchase_price=Decimal('0.00'),
                total_purchase_cost=Decimal('0.00'),
            )

        today = timezone.localdate(sale.created_at)
        detail = sales_margin_analytics(today, today)
        sale_row = detail['sales'][0]
        product_rows = detail['products']

        product_discount = sum(
            (Decimal(str(row['discount'])) for row in product_rows),
            Decimal('0.00'),
        )
        product_revenue = sum(
            (Decimal(str(row['revenue'])) for row in product_rows),
            Decimal('0.00'),
        )
        product_margin = sum(
            (Decimal(str(row['margin'])) for row in product_rows),
            Decimal('0.00'),
        )

        self.assertEqual(product_discount, Decimal('0.01'))
        self.assertEqual(product_revenue, Decimal(str(sale_row['revenue'])))
        self.assertEqual(product_margin, Decimal(str(sale_row['margin'])))


class UndatedExpenseAllocationRoundingTests(TestCase):
    def setUp(self):
        monthly = MonthlyAccounting.objects.create(year=2026, month=4)
        category = ExpenseCategory.objects.create(name='Charge mensuelle')
        Expense.objects.create(
            monthly=monthly,
            category=category,
            amount=Decimal('100.00'),
            incurred_on=None,
        )
        self.view = PeriodSummaryView()

    def test_every_subperiod_total_matches_monthly_prorata_rounded_once(self):
        periods = [
            (date(2026, 4, 1), date(2026, 4, 1)),
            (date(2026, 4, 2), date(2026, 4, 8)),
            (date(2026, 4, 10), date(2026, 4, 29)),
            (date(2026, 4, 1), date(2026, 4, 30)),
        ]

        for start, end in periods:
            with self.subTest(start=start, end=end):
                shares = self.view._undated_share_by_day(start, end)
                days = (end - start).days + 1
                expected = (
                    Decimal('100.00') * Decimal(days) / Decimal(30)
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

                self.assertEqual(len(shares), days)
                self.assertEqual(sum(shares.values(), Decimal('0.00')), expected)
                self.assertTrue(
                    all(value.as_tuple().exponent == -2 for value in shares.values())
                )
