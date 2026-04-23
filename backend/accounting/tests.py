from decimal import Decimal
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import User
from .models import ExpenseCategory, MonthlyAccounting


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
                    '/api/accounting/expenses/', '/api/accounting/summary/']:
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
        self.cat = ExpenseCategory.objects.create(name='Internet')

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
