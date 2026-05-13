from decimal import Decimal
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import User
from inventory.models import Product
from sales.models import Return, Sale, SaleItem
from .models import CashRegisterAdjustment, ExpenseCategory, MonthlyAccounting


class AccountingPermissionsTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin1', password='pwd', role=User.Role.ADMIN
        )
        self.cashier = User.objects.create_user(
            username='cashier1', password='pwd', role=User.Role.CASHIER
        )
        ExpenseCategory.objects.create(name='Test', is_default=True)

    def test_cashier_forbidden(self):
        c = APIClient()
        c.force_authenticate(self.cashier)
        for url in ['/api/accounting/categories/', '/api/accounting/monthly/',
                    '/api/accounting/expenses/', '/api/accounting/summary/',
                    '/api/accounting/cash-register/']:
            r = c.get(url)
            self.assertEqual(r.status_code, 403, msg=url)

    def test_admin_allowed(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        r = c.get('/api/accounting/categories/')
        self.assertEqual(r.status_code, 200)

    def test_default_category_not_deletable(self):
        c = APIClient()
        c.force_authenticate(self.admin)
        cat = ExpenseCategory.objects.filter(is_default=True).first()
        r = c.delete(f'/api/accounting/categories/{cat.id}/')
        self.assertEqual(r.status_code, 403)


class MonthlySummaryTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin2', password='pwd', role=User.Role.ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.cat, _ = ExpenseCategory.objects.get_or_create(name='Internet')

    def test_create_expense_by_period_and_summary(self):
        r = self.client.post('/api/accounting/expenses/', {
            'year': 2026, 'month': 4, 'category': self.cat.id, 'amount': '150.00'
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)

        # Set withdrawal
        monthly = MonthlyAccounting.objects.get(year=2026, month=4)
        monthly.manager_withdrawal = Decimal('500')
        monthly.save()

        r = self.client.get('/api/accounting/monthly/by-period/2026/4/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['total_expenses'], 150.0)
        self.assertEqual(float(r.data['manager_withdrawal']), 500.0)

        r = self.client.get('/api/accounting/summary/?year=2026')
        self.assertEqual(r.status_code, 200)
        april = next(m for m in r.data['months'] if m['month'] == 4)
        self.assertEqual(april['expenses'], 150.0)
        self.assertEqual(april['manager_withdrawal'], 500.0)

    def test_margin_detail_is_returned_for_day_month_and_year(self):
        product = Product.objects.create(
            name='Stylo',
            barcode='STYLO-TEST',
            purchase_price=Decimal('1.00'),
            sale_price_ht=Decimal('2.00'),
            stock=20,
        )
        sale = Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('20.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('18.00'),
            discount_amount=Decimal('2.00'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=product.name,
            quantity=10,
            unit_price_ht=Decimal('2.00'),
            total_price_ht=Decimal('20.00'),
            tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('1.00'),
            total_purchase_cost=Decimal('10.00'),
        )
        Sale.objects.filter(pk=sale.pk).update(created_at='2026-04-24T10:00:00Z')

        period = self.client.get('/api/accounting/period-summary/?type=day&date=2026-04-24')
        self.assertEqual(period.status_code, 200)
        detail = period.data['sales_margin_detail']
        self.assertEqual(detail['sales'][0]['items_count'], 10)
        self.assertEqual(detail['sales'][0]['revenue'], 18.0)
        self.assertEqual(detail['sales'][0]['margin'], 8.0)
        self.assertEqual(detail['products'][0]['product_name'], 'Stylo')
        self.assertEqual(detail['products'][0]['quantity'], 10)
        self.assertEqual(detail['products'][0]['revenue'], 18.0)
        self.assertEqual(detail['products'][0]['margin'], 8.0)

        month = self.client.get('/api/accounting/monthly/by-period/2026/4/')
        self.assertEqual(month.status_code, 200)
        self.assertEqual(month.data['sales_margin_detail']['products'][0]['quantity'], 10)

        year = self.client.get('/api/accounting/summary/?year=2026')
        self.assertEqual(year.status_code, 200)
        self.assertEqual(year.data['sales_margin_detail']['sales'][0]['margin'], 8.0)


class CashRegisterTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin3', password='pwd', role=User.Role.ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.cat, _ = ExpenseCategory.objects.get_or_create(name='Fournitures')

    def test_cash_register_balance_uses_opening_sales_returns_and_expenses(self):
        self.client.post('/api/accounting/cash-register/', {
            'action': 'set_opening',
            'opening_amount': '500.00',
        }, format='json')
        Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('120.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('120.00'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        card_sale = Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('80.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('80.00'),
            payment_method=Sale.PaymentMethod.CARD,
        )
        Return.objects.create(
            sale=card_sale,
            status=Return.ReturnStatus.COMPLETED,
            reason='Test',
            refund_amount=Decimal('20.00'),
            processed_by=self.admin,
        )
        self.client.post('/api/accounting/expenses/', {
            'year': 2026,
            'month': 4,
            'category': self.cat.id,
            'amount': '30.00',
        }, format='json')
        self.client.post('/api/accounting/expenses/', {
            'year': 2026,
            'month': 4,
            'category': self.cat.id,
            'amount': '70.00',
            'paid_from_cash': False,
        }, format='json')

        response = self.client.get('/api/accounting/cash-register/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['opening_amount'], 500.0)
        self.assertEqual(response.data['cash_sales_total'], 120.0)
        self.assertEqual(response.data['returns_total'], 20.0)
        self.assertEqual(response.data['expenses_total'], 30.0)
        self.assertEqual(response.data['balance'], 570.0)

    def test_count_creates_adjustment_to_real_amount(self):
        CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
            amount=Decimal('500.00'),
            counted_amount=Decimal('500.00'),
            created_by=self.admin,
        )
        Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('100.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('100.00'),
            payment_method=Sale.PaymentMethod.CASH,
        )

        response = self.client.post('/api/accounting/cash-register/', {
            'action': 'count',
            'counted_amount': '590.00',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['balance'], 590.0)
        adjustment = CashRegisterAdjustment.objects.latest('created_at')
        self.assertEqual(adjustment.adjustment_type, CashRegisterAdjustment.AdjustmentType.COUNT)
        self.assertEqual(adjustment.amount, Decimal('-10.00'))
