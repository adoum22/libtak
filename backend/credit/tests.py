from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounting.models import CashRegisterState
from core.models import AuditLog
from inventory.models import Product, ProductCostLayer
from sales.aggregates import financials_for_period
from sales.models import Return, Sale

from .models import CreditPayment, CreditSale, Customer


User = get_user_model()


class CreditFlowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='alice', password='Strongpassw0rd!', role='ADMIN',
        )
        self.client.force_authenticate(self.user)
        self.product = Product.objects.create(
            name='Cahier', barcode='C-1', stock=10,
            sale_price_ht=20, purchase_price=12, tva=0,
        )
        ProductCostLayer.create_layer(
            product=self.product, quantity=10,
            unit_cost=12, sale_price=20, note='seed',
        )
        self.customer = Customer.objects.create(name='Ahmed')

    def _create_credit_sale(self, quantity=2):
        url = reverse('sale-list')
        payload = {
            'items': [{'product_id': self.product.id, 'quantity': quantity}],
            'payment_method': 'CREDIT',
            'customer_id': self.customer.id,
            'discount_amount': 0,
        }
        return self.client.post(url, payload, format='json')

    def _pay(self, credit, amount, operation_id, note=''):
        return self.client.post(
            reverse('creditsale-pay', args=[credit.id]),
            {
                'amount': amount,
                'note': note,
                'operation_id': operation_id,
            },
            format='json',
        )

    def _reverse(self, credit, payment, operation_id, reason='Erreur de saisie'):
        return self.client.post(
            (
                f'/api/credit/credits/{credit.id}/payments/'
                f'{payment.id}/reverse/'
            ),
            {'reason': reason, 'operation_id': operation_id},
            format='json',
        )

    def _create_approve_credit_return(self, credit, quantity=1):
        sale_item = credit.sale.items.get()
        created = self.client.post(
            '/api/sales/returns/',
            {
                'sale': credit.sale_id,
                'reason': 'Retour client crédit',
                'items': [{
                    'sale_item': sale_item.id,
                    'quantity': quantity,
                }],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        approved = self.client.post(
            f"/api/sales/returns/{created.data['id']}/approve/",
            {},
            format='json',
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK, approved.data)
        return created.data['id']

    def test_credit_sale_creates_credit_record_and_decrements_stock(self):
        response = self._create_credit_sale(quantity=2)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 8)

        credit = CreditSale.objects.get()
        self.assertEqual(credit.customer, self.customer)
        self.assertEqual(credit.status, CreditSale.Status.UNPAID)
        self.assertEqual(float(credit.paid_amount), 0.0)
        self.assertEqual(float(credit.sale.total_ttc), 40.0)

    def test_credit_sale_requires_customer(self):
        url = reverse('sale-list')
        payload = {
            'items': [{'product_id': self.product.id, 'quantity': 1}],
            'payment_method': 'CREDIT',
            'discount_amount': 0,
        }
        response = self.client.post(url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_partial_payment_marks_partial_then_paid(self):
        self._create_credit_sale(quantity=2)  # total = 40
        credit = CreditSale.objects.get()

        response = self._pay(credit, '15', 'credit-pay-partial-0001')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        credit.refresh_from_db()
        self.assertEqual(credit.status, CreditSale.Status.PARTIAL)
        self.assertEqual(float(credit.paid_amount), 15.0)

        response = self._pay(credit, '25', 'credit-pay-partial-0002')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        credit.refresh_from_db()
        self.assertEqual(credit.status, CreditSale.Status.PAID)
        self.assertEqual(float(credit.paid_amount), 40.0)
        self.assertEqual(CreditPayment.objects.count(), 2)

    def test_cannot_overpay(self):
        self._create_credit_sale(quantity=2)  # total = 40
        credit = CreditSale.objects.get()
        response = self._pay(credit, '999', 'credit-pay-overpay-0001')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_payment_requires_valid_idempotency_key_and_strict_payload(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        url = reverse('creditsale-pay', args=[credit.id])

        missing_key = self.client.post(url, {'amount': '1.00'}, format='json')
        short_key = self.client.post(
            url,
            {'amount': '1.00', 'operation_id': 'court'},
            format='json',
        )
        mismatched_keys = self.client.post(
            url,
            {'amount': '1.00', 'operation_id': 'payment-body-0001'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='payment-header-0001',
        )

        self.assertEqual(missing_key.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(short_key.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(mismatched_keys.status_code, status.HTTP_400_BAD_REQUEST)

        invalid_payloads = (
            {'amount': '0.00', 'operation_id': 'payment-invalid-0001'},
            {'amount': '-1.00', 'operation_id': 'payment-invalid-0002'},
            {'amount': 'NaN', 'operation_id': 'payment-invalid-0003'},
            {'amount': '1.001', 'operation_id': 'payment-invalid-0004'},
            {'amount': '123456789.00', 'operation_id': 'payment-invalid-0005'},
            {
                'amount': '1.00',
                'note': 'x' * 201,
                'operation_id': 'payment-invalid-0006',
            },
            {
                'amount': ['1.00'],
                'operation_id': 'payment-invalid-0007',
            },
            {
                'amount': '1.00',
                'note': ['note invalide'],
                'operation_id': 'payment-invalid-0008',
            },
        )
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.post(url, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(CreditPayment.objects.count(), 0)
        credit.refresh_from_db()
        self.assertEqual(credit.paid_amount, Decimal('0.00'))

    def test_payment_accepts_header_key_and_replay_is_idempotent(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        url = reverse('creditsale-pay', args=[credit.id])
        payload = {'amount': '15.00', 'note': '  Acompte client  '}

        first = self.client.post(
            url,
            payload,
            format='json',
            HTTP_IDEMPOTENCY_KEY='payment-header-0002',
        )
        replay = self.client.post(
            url,
            {'amount': '15', 'note': 'Acompte client'},
            format='json',
            HTTP_IDEMPOTENCY_KEY='payment-header-0002',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(CreditPayment.objects.count(), 1)
        payment = CreditPayment.objects.get()
        self.assertEqual(payment.amount, Decimal('15.00'))
        self.assertEqual(payment.note, 'Acompte client')
        credit.refresh_from_db()
        self.assertEqual(credit.paid_amount, Decimal('15.00'))
        self.assertEqual(credit.status, CreditSale.Status.PARTIAL)
        self.assertEqual(
            AuditLog.objects.filter(
                model_name='CreditPayment',
                object_id=payment.id,
                action=AuditLog.ActionType.CREATE,
            ).count(),
            1,
        )

    def test_payment_key_conflict_does_not_mutate_credit(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        first = self._pay(credit, '10.00', 'payment-conflict-0001', 'Acompte')
        conflict = self._pay(
            credit,
            '11.00',
            'payment-conflict-0001',
            'Acompte',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(CreditPayment.objects.count(), 1)
        credit.refresh_from_db()
        self.assertEqual(credit.paid_amount, Decimal('10.00'))

    def test_full_payment_can_be_replayed_after_credit_is_paid(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()

        first = self._pay(credit, '40.00', 'payment-full-replay-0001')
        replay = self._pay(credit, '40', 'payment-full-replay-0001')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(replay.status_code, status.HTTP_200_OK, replay.data)
        self.assertEqual(CreditPayment.objects.count(), 1)
        credit.refresh_from_db()
        self.assertEqual(credit.status, CreditSale.Status.PAID)
        self.assertEqual(credit.paid_amount, Decimal('40.00'))

    def test_payment_and_audit_log_are_atomic(self):
        self._create_credit_sale(quantity=1)
        credit = CreditSale.objects.get()

        with patch('credit.views.AuditLog.log', side_effect=RuntimeError('audit down')):
            with self.assertRaises(RuntimeError):
                self._pay(credit, '20.00', 'payment-atomic-0001')

        self.assertEqual(CreditPayment.objects.count(), 0)
        credit.refresh_from_db()
        self.assertEqual(credit.paid_amount, Decimal('0.00'))
        self.assertEqual(credit.status, CreditSale.Status.UNPAID)

    def test_credit_sale_excluded_from_cash_register(self):
        from accounting.views import CashRegisterView

        self._create_credit_sale(quantity=1)  # total = 20, payment_method=CREDIT
        view = CashRegisterView()
        summary = view._summary()
        # La vente crédit ne doit PAS être comptée dans cash_sales_total
        self.assertEqual(float(summary['cash_sales_total']), 0.0)
        # Pas de paiement => credit_payments_total = 0
        self.assertEqual(float(summary.get('credit_payments_total', 0)), 0.0)

        # Après règlement, le montant entre dans la caisse
        credit = CreditSale.objects.get()
        response = self._pay(credit, '20', 'credit-cash-payment-0001')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        summary = view._summary()
        self.assertEqual(float(summary['cash_sales_total']), 0.0)
        self.assertEqual(float(summary['credit_payments_total']), 20.0)
        self.assertEqual(float(summary['balance']), 20.0)
        self.assertTrue(CashRegisterState.objects.filter(pk=1).exists())

        api_summary = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(api_summary.status_code, status.HTTP_200_OK)
        self.assertEqual(api_summary.data['credit_payments_total'], 20.0)

    def test_reversal_keeps_audit_trail_and_updates_credit_and_cash(self):
        self._create_credit_sale(quantity=1)
        credit = CreditSale.objects.get()
        pay_response = self._pay(credit, '20.00', 'payment-reverse-0001')
        self.assertEqual(pay_response.status_code, status.HTTP_201_CREATED)
        payment = CreditPayment.objects.get()

        reversed_response = self._reverse(
            credit,
            payment,
            'reversal-operation-0001',
            'Montant saisi sur le mauvais client',
        )

        self.assertEqual(
            reversed_response.status_code,
            status.HTTP_200_OK,
            reversed_response.data,
        )
        payment.refresh_from_db()
        credit.refresh_from_db()
        self.assertEqual(CreditPayment.objects.count(), 1)
        self.assertEqual(payment.status, CreditPayment.PaymentStatus.REVERSED)
        self.assertEqual(payment.reversed_by, self.user)
        self.assertIsNotNone(payment.reversed_at)
        self.assertEqual(
            payment.reversal_reason,
            'Montant saisi sur le mauvais client',
        )
        self.assertEqual(credit.paid_amount, Decimal('0.00'))
        self.assertEqual(credit.status, CreditSale.Status.UNPAID)
        self.assertEqual(reversed_response.data['payments'][0]['status'], 'REVERSED')

        cash_summary = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(cash_summary.status_code, status.HTTP_200_OK)
        self.assertEqual(cash_summary.data['credit_payments_total'], 0.0)
        self.assertEqual(cash_summary.data['balance'], 0.0)
        self.assertEqual(
            AuditLog.objects.filter(
                model_name='CreditPayment',
                object_id=payment.id,
                action=AuditLog.ActionType.UPDATE,
            ).count(),
            1,
        )

        replay = self._reverse(
            credit,
            payment,
            'reversal-operation-0001',
            'Montant saisi sur le mauvais client',
        )
        conflicting_reversal = self._reverse(
            credit,
            payment,
            'reversal-operation-0002',
            'Montant saisi sur le mauvais client',
        )
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(conflicting_reversal.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(
            AuditLog.objects.filter(
                model_name='CreditPayment',
                object_id=payment.id,
                action=AuditLog.ActionType.UPDATE,
            ).count(),
            1,
        )

    def test_reversing_one_payment_recomputes_partial_state(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        self._pay(credit, '15.00', 'payment-partial-reverse-0001')
        self._pay(credit, '25.00', 'payment-partial-reverse-0002')
        payment_to_reverse = CreditPayment.objects.get(amount=Decimal('25.00'))

        response = self._reverse(
            credit,
            payment_to_reverse,
            'reversal-partial-0001',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        credit.refresh_from_db()
        self.assertEqual(credit.paid_amount, Decimal('15.00'))
        self.assertEqual(credit.status, CreditSale.Status.PARTIAL)
        summary = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(summary.data['credit_payments_total'], 15.0)
        self.assertEqual(summary.data['balance'], 15.0)

    def test_reversed_payment_is_excluded_from_all_financial_aggregates(self):
        self._create_credit_sale(quantity=1)
        credit = CreditSale.objects.get()
        self._pay(credit, '20.00', 'payment-aggregate-0001')
        payment = CreditPayment.objects.get()
        today = timezone.localdate()

        active_financials = financials_for_period(today, today)
        active_period = self.client.get(
            '/api/accounting/period-summary/',
            {'type': 'day', 'date': today.isoformat()},
        )
        active_stats = self.client.get('/api/reporting/stats/', {'days': 1})
        self.assertEqual(active_financials['net_revenue'], Decimal('20.00'))
        self.assertEqual(active_financials['gross_cost'], Decimal('12.00'))
        self.assertEqual(active_period.data['revenue'], 20.0)
        self.assertEqual(active_stats.data['today']['revenue'], 20.0)

        reversal = self._reverse(
            credit,
            payment,
            'reversal-aggregate-0001',
        )
        self.assertEqual(reversal.status_code, status.HTTP_200_OK, reversal.data)

        reversed_financials = financials_for_period(today, today)
        reversed_period = self.client.get(
            '/api/accounting/period-summary/',
            {'type': 'day', 'date': today.isoformat()},
        )
        reversed_stats = self.client.get('/api/reporting/stats/', {'days': 1})
        self.assertEqual(reversed_financials['net_revenue'], Decimal('0.00'))
        self.assertEqual(reversed_financials['gross_cost'], Decimal('0.00'))
        self.assertEqual(reversed_period.data['revenue'], 0.0)
        self.assertEqual(reversed_period.data['gross_margin'], 0.0)
        self.assertEqual(reversed_stats.data['today']['revenue'], 0.0)
        self.assertEqual(reversed_stats.data['revenue_7d'][0]['revenue'], 0.0)

    def test_reversal_is_admin_only_and_rolls_back_if_audit_fails(self):
        self._create_credit_sale(quantity=1)
        credit = CreditSale.objects.get()
        self._pay(credit, '20.00', 'payment-reverse-auth-0001')
        payment = CreditPayment.objects.get()
        cashier = User.objects.create_user(
            username='cashier',
            password='Strongpassw0rd!',
            role=User.Role.CASHIER,
        )
        self.client.force_authenticate(cashier)
        forbidden = self._reverse(
            credit,
            payment,
            'reversal-forbidden-0001',
        )
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.user)
        with patch('credit.views.AuditLog.log', side_effect=RuntimeError('audit down')):
            with self.assertRaises(RuntimeError):
                self._reverse(
                    credit,
                    payment,
                    'reversal-atomic-0001',
                )

        payment.refresh_from_db()
        credit.refresh_from_db()
        self.assertEqual(payment.status, CreditPayment.PaymentStatus.ACTIVE)
        self.assertEqual(credit.status, CreditSale.Status.PAID)
        self.assertEqual(credit.paid_amount, Decimal('20.00'))
        summary = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(summary.data['credit_payments_total'], 20.0)

    def test_unpaid_credit_return_reduces_debt_without_negative_revenue(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        return_id = self._create_approve_credit_return(credit, quantity=1)

        credit.refresh_from_db()
        self.assertEqual(credit.remaining_amount, Decimal('40.00'))
        completed = self.client.post(
            f'/api/sales/returns/{return_id}/complete/',
            {},
            format='json',
        )

        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        self.assertEqual(Decimal(completed.data['refund_amount']), Decimal('20.00'))
        self.assertEqual(
            Decimal(completed.data['cash_refund_amount']),
            Decimal('0.00'),
        )
        self.assertEqual(completed.data['refund_method'], Sale.PaymentMethod.CREDIT)
        credit.refresh_from_db()
        self.assertEqual(credit.adjusted_total, Decimal('20.00'))
        self.assertEqual(credit.paid_amount, Decimal('0.00'))
        self.assertEqual(credit.remaining_amount, Decimal('20.00'))
        self.assertEqual(credit.status, CreditSale.Status.UNPAID)
        today = timezone.localdate()
        financials = financials_for_period(today, today)
        self.assertEqual(financials['net_revenue'], Decimal('0.00'))
        self.assertEqual(financials['net_cost'], Decimal('0.00'))

    def test_credit_return_refunds_only_overpayment_and_reconciles_cash(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        paid = self._pay(credit, '30.00', 'payment-before-return-0001')
        self.assertEqual(paid.status_code, status.HTTP_201_CREATED, paid.data)
        payment = CreditPayment.objects.get()
        return_id = self._create_approve_credit_return(credit, quantity=1)

        completed = self.client.post(
            f'/api/sales/returns/{return_id}/complete/',
            {},
            format='json',
        )

        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        self.assertEqual(Decimal(completed.data['refund_amount']), Decimal('20.00'))
        self.assertEqual(
            Decimal(completed.data['cash_refund_amount']),
            Decimal('10.00'),
        )
        self.assertEqual(completed.data['refund_method'], Sale.PaymentMethod.CASH)
        credit.refresh_from_db()
        self.assertEqual(credit.adjusted_total, Decimal('20.00'))
        self.assertEqual(credit.paid_amount, Decimal('20.00'))
        self.assertEqual(credit.remaining_amount, Decimal('0.00'))
        self.assertEqual(credit.status, CreditSale.Status.PAID)

        cash = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(cash.data['credit_payments_total'], 30.0)
        self.assertEqual(cash.data['returns_total'], 10.0)
        self.assertEqual(cash.data['balance'], 20.0)
        financials = financials_for_period(
            timezone.localdate(), timezone.localdate(),
        )
        self.assertEqual(financials['net_revenue'], Decimal('20.00'))
        self.assertEqual(financials['net_cost'], Decimal('12.00'))
        self.assertEqual(financials['gross_margin'], Decimal('8.00'))

        blocked_reversal = self._reverse(
            credit,
            payment,
            'reversal-after-refund-0001',
        )
        self.assertEqual(blocked_reversal.status_code, status.HTTP_409_CONFLICT)
        payment.refresh_from_db()
        self.assertEqual(payment.status, CreditPayment.PaymentStatus.ACTIVE)

    def test_credit_return_completion_is_atomic_with_audit_log(self):
        self._create_credit_sale(quantity=2)
        credit = CreditSale.objects.get()
        self._pay(credit, '30.00', 'payment-return-atomic-0001')
        return_id = self._create_approve_credit_return(credit, quantity=1)

        with patch('sales.views.AuditLog.log', side_effect=RuntimeError('audit down')):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f'/api/sales/returns/{return_id}/complete/',
                    {},
                    format='json',
                )

        return_order = Return.objects.get(pk=return_id)
        credit.refresh_from_db()
        self.assertEqual(return_order.status, Return.ReturnStatus.APPROVED)
        self.assertEqual(return_order.cash_refund_amount, Decimal('0.00'))
        self.assertEqual(credit.paid_amount, Decimal('30.00'))
        self.assertEqual(credit.remaining_amount, Decimal('10.00'))

    def test_payment_database_constraints_reject_invalid_ledger_rows(self):
        self._create_credit_sale(quantity=1)
        credit = CreditSale.objects.get()

        invalid_rows = (
            {'amount': Decimal('0.00')},
            {
                'amount': Decimal('1.00'),
                'operation_id': 'payment-missing-hash-0001',
            },
            {
                'amount': Decimal('1.00'),
                'status': CreditPayment.PaymentStatus.REVERSED,
            },
        )
        for values in invalid_rows:
            with self.subTest(values=values):
                with self.assertRaises(IntegrityError):
                    with transaction.atomic():
                        CreditPayment.objects.create(
                            credit_sale=credit,
                            created_by=self.user,
                            **values,
                        )

        self.assertEqual(CreditPayment.objects.count(), 0)
