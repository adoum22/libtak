from datetime import date
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounting.models import CashRegisterAdjustment
from core.models import AuditLog
from sales.aggregates import gross_margin_for_period
from sales.models import Sale, SaleItem

from .models import (
    Product,
    ProductCostLayer,
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
    SupplierPayment,
)


User = get_user_model()


class SupplierPaymentApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='supplier-payment-admin',
            password='Strong-Supplier-Payment-2026!',
            role=User.Role.ADMIN,
        )
        self.cashier = User.objects.create_user(
            username='supplier-payment-cashier',
            password='Strong-Supplier-Cashier-2026!',
            role=User.Role.CASHIER,
        )
        self.supplier = Supplier.objects.create(name='Diffuseur test')
        self.product = Product.objects.create(
            name='Roman règlement',
            barcode='SUPPLIER-PAYMENT-001',
            purchase_price=Decimal('10.00'),
            sale_price_ht=Decimal('20.00'),
            stock=0,
        )
        self.order = self._order()
        self.client.force_authenticate(self.admin)

    def _order(self, *, order_status=PurchaseOrder.OrderStatus.SENT):
        order = PurchaseOrder.objects.create(
            supplier=self.supplier,
            status=order_status,
            created_by=self.admin,
        )
        PurchaseOrderItem.objects.create(
            order=order,
            product=self.product,
            quantity=10,
            unit_cost=Decimal('10.00'),
            sale_price=Decimal('20.00'),
        )
        return order

    def _pay(self, amount, *, order=None, method='CASH', operation_id=None):
        order = order or self.order
        return self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/payments/',
            {
                'amount': str(amount),
                'method': method,
                'paid_on': timezone.localdate().isoformat(),
                'reference': 'FACT-2026-001',
                'note': 'Test automatisé',
                'operation_id': operation_id or str(uuid4()),
            },
            format='json',
        )

    def test_cashier_is_forbidden(self):
        self.client.force_authenticate(self.cashier)

        response = self._pay('10.00')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(SupplierPayment.objects.count(), 0)

    def test_partial_then_complete_and_overpayment_is_atomic(self):
        partial = self._pay('40.00', method='BANK')
        self.assertEqual(partial.status_code, status.HTTP_201_CREATED)
        self.assertEqual(partial.data['order']['payment_status'], 'PARTIAL')
        self.assertEqual(Decimal(partial.data['order']['paid_amount']), Decimal('40.00'))
        self.assertEqual(Decimal(partial.data['order']['balance_due']), Decimal('60.00'))

        overpayment = self._pay('60.01', method='OTHER')
        self.assertEqual(overpayment.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(SupplierPayment.objects.count(), 1)

        complete = self._pay('60.00', method='OTHER')
        self.assertEqual(complete.status_code, status.HTTP_201_CREATED)
        self.assertEqual(complete.data['order']['payment_status'], 'PAID')
        self.assertEqual(Decimal(complete.data['order']['paid_amount']), Decimal('100.00'))
        self.assertEqual(Decimal(complete.data['order']['balance_due']), Decimal('0.00'))

    def test_draft_and_cancelled_orders_cannot_be_paid(self):
        draft = self._order(order_status=PurchaseOrder.OrderStatus.DRAFT)
        cancelled = self._order(order_status=PurchaseOrder.OrderStatus.CANCELLED)

        self.assertEqual(self._pay('10.00', order=draft).status_code, 409)
        self.assertEqual(self._pay('10.00', order=cancelled).status_code, 409)
        self.assertEqual(SupplierPayment.objects.count(), 0)

    def test_creation_idempotency_and_conflict(self):
        operation_id = str(uuid4())
        first = self._pay('25.00', operation_id=operation_id)
        replay = self._pay('25.00', operation_id=operation_id)
        conflict = self._pay('26.00', operation_id=operation_id)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.data['idempotent_replay'])
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(SupplierPayment.objects.count(), 1)

    def test_reversal_is_durable_idempotent_and_audited(self):
        created = self._pay('35.00')
        payment_id = created.data['payment']['id']
        blocked_cancel = self.client.post(
            f'/api/inventory/purchase-orders/{self.order.pk}/cancel/',
            {},
            format='json',
        )
        self.assertEqual(blocked_cancel.status_code, 409)
        operation_id = str(uuid4())
        url = (
            f'/api/inventory/purchase-orders/{self.order.pk}/'
            f'payments/{payment_id}/reverse/'
        )
        payload = {
            'reason': 'Erreur de mode de paiement',
            'operation_id': operation_id,
        }

        reversed_response = self.client.post(url, payload, format='json')
        replay = self.client.post(url, payload, format='json')

        self.assertEqual(reversed_response.status_code, 200)
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.data['idempotent_replay'])
        payment = SupplierPayment.objects.get(pk=payment_id)
        self.assertEqual(payment.status, SupplierPayment.PaymentStatus.REVERSED)
        self.assertEqual(payment.reversal_reason, payload['reason'])
        self.assertIsNotNone(payment.reversed_at)
        self.assertEqual(SupplierPayment.objects.count(), 1)
        self.assertEqual(replay.data['order']['payment_status'], 'UNPAID')
        self.assertTrue(AuditLog.objects.filter(
            model_name='SupplierPayment',
            object_id=payment_id,
            action=AuditLog.ActionType.CREATE,
        ).exists())
        self.assertTrue(AuditLog.objects.filter(
            model_name='SupplierPayment',
            object_id=payment_id,
            action=AuditLog.ActionType.UPDATE,
        ).exists())
        cancelled = self.client.post(
            f'/api/inventory/purchase-orders/{self.order.pk}/cancel/',
            {},
            format='json',
        )
        self.assertEqual(cancelled.status_code, 200)
        durable_history = self.client.delete(
            f'/api/inventory/purchase-orders/{self.order.pk}/'
        )
        self.assertEqual(durable_history.status_code, 409)
        self.assertTrue(SupplierPayment.objects.filter(pk=payment_id).exists())

    def test_cash_affects_register_bank_does_not_and_reversal_restores_cash(self):
        CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
            amount=Decimal('500.00'),
            counted_amount=Decimal('500.00'),
            created_by=self.admin,
        )
        cash = self._pay('30.00', method='CASH')
        bank = self._pay('20.00', method='BANK')
        self.assertEqual(cash.status_code, 201)
        self.assertEqual(bank.status_code, 201)

        register = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(register.status_code, 200)
        self.assertEqual(register.data['supplier_payments_total'], 30.0)
        self.assertEqual(register.data['balance'], 470.0)

        payment_id = cash.data['payment']['id']
        reversed_response = self.client.post(
            (
                f'/api/inventory/purchase-orders/{self.order.pk}/'
                f'payments/{payment_id}/reverse/'
            ),
            {
                'reason': 'Paiement annulé',
                'operation_id': str(uuid4()),
            },
            format='json',
        )
        self.assertEqual(reversed_response.status_code, 200)
        restored = self.client.get('/api/accounting/cash-register/')
        self.assertEqual(restored.data['supplier_payments_total'], 0.0)
        self.assertEqual(restored.data['balance'], 500.0)

    def test_supplier_payment_is_reported_but_never_changes_margin_or_profit(self):
        sale = Sale.objects.create(
            user=self.admin,
            total_ht=Decimal('50.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('50.00'),
            payment_method=Sale.PaymentMethod.CARD,
            amount_received=Decimal('50.00'),
        )
        SaleItem.objects.create(
            sale=sale,
            product=self.product,
            product_name=self.product.name,
            quantity=1,
            unit_price_ht=Decimal('50.00'),
            total_price_ht=Decimal('50.00'),
            tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('30.00'),
            total_purchase_cost=Decimal('30.00'),
        )
        today = timezone.localdate()
        margin_before = gross_margin_for_period(today, today)

        payment = self._pay('40.00', method='BANK')
        margin_after = gross_margin_for_period(today, today)
        accounting = self.client.get(
            f'/api/accounting/period-summary/?type=day&date={today.isoformat()}'
        )
        monthly = self.client.get(
            f'/api/accounting/monthly/by-period/{today.year}/{today.month}/'
        )
        yearly = self.client.get(
            f'/api/accounting/summary/?year={today.year}'
        )

        self.assertEqual(payment.status_code, 201)
        self.assertEqual(margin_before, Decimal('20.00'))
        self.assertEqual(margin_after, margin_before)
        self.assertEqual(accounting.status_code, 200)
        self.assertEqual(accounting.data['gross_margin'], 20.0)
        self.assertEqual(accounting.data['net_profit'], 20.0)
        self.assertEqual(accounting.data['supplier_payments'], 40.0)
        self.assertEqual(monthly.data['supplier_payments_total'], 40.0)
        self.assertEqual(monthly.data['net_profit'], 20.0)
        self.assertEqual(yearly.data['totals']['supplier_payments'], 40.0)
        self.assertEqual(yearly.data['totals']['net_profit'], 20.0)

    def test_actual_received_cost_updates_payable_total_and_fifo(self):
        full_estimate = self._pay('100.00', method='BANK')
        self.assertEqual(full_estimate.data['order']['payment_status'], 'PAID')
        item = self.order.items.get()

        received = self.client.post(
            f'/api/inventory/purchase-orders/{self.order.pk}/receive/',
            {
                'receipt_id': f'actual-cost-{uuid4().hex[:12]}',
                'items': [{
                    'item_id': item.pk,
                    'quantity': 10,
                    'unit_cost': '12.00',
                    'new_sale_price': '22.00',
                    'update_sale_price': False,
                }],
            },
            format='json',
        )

        self.assertEqual(received.status_code, 200)
        self.assertEqual(Decimal(received.data['order']['total_amount']), Decimal('120.00'))
        self.assertEqual(Decimal(received.data['order']['paid_amount']), Decimal('100.00'))
        self.assertEqual(Decimal(received.data['order']['balance_due']), Decimal('20.00'))
        self.assertEqual(received.data['order']['payment_status'], 'PARTIAL')
        self.assertFalse(received.data['results'][0]['updated_sale_price'])
        item.refresh_from_db()
        self.assertEqual(item.received_cost_total, Decimal('120.00'))
        layer = ProductCostLayer.objects.get(product=self.product)
        self.assertEqual(layer.unit_cost, Decimal('12.00'))

        final = self._pay('20.00', method='BANK')
        self.assertEqual(final.status_code, 201)
        self.assertEqual(final.data['order']['payment_status'], 'PAID')

    def test_lower_actual_cost_cannot_create_supplier_overpayment(self):
        self._pay('100.00', method='BANK')
        item = self.order.items.get()

        response = self.client.post(
            f'/api/inventory/purchase-orders/{self.order.pk}/receive/',
            {
                'receipt_id': f'lower-cost-{uuid4().hex[:12]}',
                'items': [{
                    'item_id': item.pk,
                    'quantity': 10,
                    'unit_cost': '9.00',
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 409)
        item.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(item.received_quantity, 0)
        self.assertEqual(item.received_cost_total, Decimal('0.00'))
        self.assertEqual(self.product.stock, 0)
        self.assertFalse(ProductCostLayer.objects.filter(product=self.product).exists())
