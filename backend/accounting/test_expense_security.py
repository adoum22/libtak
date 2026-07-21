from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User

from .models import Expense, ExpenseCategory, MonthlyAccounting


class ExpenseSecurityAndIntegrityTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='expense-admin',
            password='Strong-Expense-Admin-2026!',
            role=User.Role.ADMIN,
        )
        self.cashier = User.objects.create_user(
            username='expense-cashier',
            password='Strong-Expense-Cashier-2026!',
            role=User.Role.CASHIER,
        )
        self.general_category = ExpenseCategory.objects.create(
            name='Fournitures de bureau',
        )
        self.withdrawal_category = ExpenseCategory.objects.create(
            name='Retrait gérant',
        )

    def test_cashier_can_only_use_restricted_cashier_expense_flow(self):
        self.client.force_authenticate(self.cashier)

        generic = self.client.post(
            '/api/accounting/expenses/',
            {
                'year': 2026,
                'month': 4,
                'category': self.general_category.pk,
                'amount': '12.50',
            },
            format='json',
        )
        self.assertEqual(generic.status_code, status.HTTP_403_FORBIDDEN)

        categories = self.client.get('/api/accounting/cashier-expense/')
        self.assertEqual(categories.status_code, status.HTTP_200_OK)
        self.assertNotIn(
            self.withdrawal_category.pk,
            {row['id'] for row in categories.data},
        )

        reserved = self.client.post(
            '/api/accounting/cashier-expense/',
            {
                'category': self.withdrawal_category.pk,
                'amount': '12.50',
                'incurred_on': '2026-04-20',
            },
            format='json',
        )
        self.assertEqual(reserved.status_code, status.HTTP_400_BAD_REQUEST)

        allowed = self.client.post(
            '/api/accounting/cashier-expense/',
            {
                'category': self.general_category.pk,
                'amount': '12.50',
                'description': 'Papier caisse',
                'incurred_on': '2026-04-20',
            },
            format='json',
        )
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED, allowed.data)
        expense = Expense.objects.get(pk=allowed.data['id'])
        self.assertEqual(expense.created_by, self.cashier)
        self.assertEqual(expense.amount, Decimal('12.50'))
        self.assertTrue(expense.paid_from_cash)
        self.assertEqual((expense.monthly.year, expense.monthly.month), (2026, 4))
        self.assertEqual(allowed.data['created_by_name'], self.cashier.username)

    def test_admin_expense_is_attributed_and_period_must_match_date(self):
        self.client.force_authenticate(self.admin)

        zero = self.client.post(
            '/api/accounting/expenses/',
            {
                'year': 2026,
                'month': 4,
                'category': self.general_category.pk,
                'amount': '0.00',
            },
            format='json',
        )
        self.assertEqual(zero.status_code, status.HTTP_400_BAD_REQUEST)

        mismatch = self.client.post(
            '/api/accounting/expenses/',
            {
                'year': 2026,
                'month': 4,
                'category': self.general_category.pk,
                'amount': '25.00',
                'incurred_on': '2026-05-01',
            },
            format='json',
        )
        self.assertEqual(mismatch.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(MonthlyAccounting.objects.filter(year=2026, month=4).exists())

        created = self.client.post(
            '/api/accounting/expenses/',
            {
                'year': 2026,
                'month': 4,
                'category': self.general_category.pk,
                'amount': '25.00',
                'incurred_on': '2026-04-30',
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        expense = Expense.objects.get(pk=created.data['id'])
        self.assertEqual(expense.created_by, self.admin)

    def test_manager_withdrawal_date_must_match_selected_month(self):
        self.client.force_authenticate(self.admin)
        monthly = MonthlyAccounting.objects.create(year=2026, month=4)

        response = self.client.post(
            f'/api/accounting/monthly/{monthly.pk}/withdraw/',
            {
                'amount': '100.00',
                'incurred_on': '2026-05-01',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Expense.objects.count(), 0)
