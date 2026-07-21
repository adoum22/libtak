from datetime import date
from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from core.models import AuditLog, User

from .models import Expense, ExpenseCategory, MonthlyAccounting


class ExpenseIdempotencyTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='expense-idempotency-admin',
            password='Strong-Expense-Admin-2026!',
            role=User.Role.ADMIN,
        )
        self.other_admin = User.objects.create_user(
            username='expense-idempotency-other-admin',
            password='Strong-Expense-Other-2026!',
            role=User.Role.ADMIN,
        )
        self.cashier = User.objects.create_user(
            username='expense-idempotency-cashier',
            password='Strong-Expense-Cashier-2026!',
            role=User.Role.CASHIER,
        )
        self.category = ExpenseCategory.objects.create(name='Transport idempotent')
        self.monthly = MonthlyAccounting.objects.create(year=2026, month=7)

    def test_admin_expense_retry_is_a_noop_and_key_is_owner_scoped(self):
        payload = {
            'monthly': self.monthly.pk,
            'category': self.category.pk,
            'amount': '12.50',
            'description': 'Livraison urgente',
            'incurred_on': '2026-07-20',
            'paid_from_cash': True,
            'operation_id': '348df775-cedc-4a54-868a-aed50ab715a8',
        }
        self.client.force_authenticate(self.admin)
        first = self.client.post('/api/accounting/expenses/', payload, format='json')
        replay = self.client.post('/api/accounting/expenses/', payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(first.data['id'], replay.data['id'])
        self.assertEqual(Expense.objects.count(), 1)
        self.assertEqual(
            AuditLog.objects.filter(model_name='Expense').count(),
            1,
        )

        conflict = self.client.post(
            '/api/accounting/expenses/',
            {**payload, 'amount': '13.00'},
            format='json',
        )
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)

        self.client.force_authenticate(self.other_admin)
        foreign_replay = self.client.post(
            '/api/accounting/expenses/', payload, format='json',
        )
        self.assertEqual(foreign_replay.status_code, status.HTTP_409_CONFLICT)
        self.assertNotIn('id', foreign_replay.data)
        self.assertEqual(Expense.objects.count(), 1)

    def test_cashier_expense_retry_cannot_debit_cash_twice(self):
        payload = {
            'category': self.category.pk,
            'amount': '7.25',
            'description': 'Course locale',
            'incurred_on': '2026-07-20',
            'operation_id': '5ead9d52-b1e7-4368-a259-b36aa20877ca',
        }
        self.client.force_authenticate(self.cashier)
        first = self.client.post(
            '/api/accounting/cashier-expense/', payload, format='json',
        )
        replay = self.client.post(
            '/api/accounting/cashier-expense/', payload, format='json',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(first.data['id'], replay.data['id'])
        self.assertEqual(Expense.objects.count(), 1)
        self.assertEqual(Expense.objects.get().amount, Decimal('7.25'))

    def test_manager_withdrawal_retry_updates_month_once(self):
        payload = {
            'amount': '30.00',
            'note': 'Retrait test idempotent',
            'incurred_on': date(2026, 7, 20).isoformat(),
            'operation_id': 'a357689c-8cb0-4751-ae39-c1c37ca0babe',
        }
        self.client.force_authenticate(self.admin)
        url = f'/api/accounting/monthly/{self.monthly.pk}/withdraw/'
        first = self.client.post(url, payload, format='json')
        replay = self.client.post(url, payload, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(Expense.objects.count(), 1)
        self.monthly.refresh_from_db()
        self.assertEqual(self.monthly.manager_withdrawal, Decimal('30.00'))

        conflict = self.client.post(
            url,
            {**payload, 'amount': '31.00'},
            format='json',
        )
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Expense.objects.count(), 1)
