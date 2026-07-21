from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User
from inventory.models import (
    PriceHistory,
    Product,
    ProductCostLayer,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseReceipt,
    StockMovement,
    Supplier,
)
from reporting.tasks import get_report_data
from sales.aggregates import financials_for_period
from sales.models import Discount, Return, Sale


class LibrarySequentialBusinessWorkflowTest(APITestCase):
    """End-to-end financial and inventory checks for a realistic bookshop flow.

    Expected catalogue and FIFO sequence (the current catalogue selling price
    applies to every active lot; FIFO only chooses acquisition cost):

    * PO #1: 10 units bought at 10.00 and sold at 20.00.
    * Sale A: 3 units -> revenue 60.00, cost 30.00, margin 30.00.
    * Sale B: 2 units with 10% off -> revenue 36.00, cost 20.00,
      margin 16.00.
    * PO #2: 8 units bought at 12.00 and sold at 25.00.
    * Sale C: 7 units all sold at the new current price 25.00, while FIFO
      costs 5 at 10.00 and 2 at 12.00 -> revenue 175.00, cost 74.00.
    * The current price is lowered to 18.00 before the lot is exhausted.
    * Sale D: 4 units at 18.00 with a fixed 5.00 discount -> revenue 67.00,
      cost 48.00, margin 19.00.
    * One unit from sale D is returned: proportional refund 16.75 and
      restocked cost 12.00.

    Final expected values: stock 3, net revenue 321.25, net cost 160.00,
    gross margin 161.25 and active FIFO stock value 36.00.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            username='workflow-admin',
            password='Strong-Test-Admin-2026!',
            role=User.Role.ADMIN,
        )
        self.cashier = User.objects.create_user(
            username='workflow-cashier',
            password='Strong-Test-Cashier-2026!',
            role=User.Role.CASHIER,
        )
        self.other_cashier = User.objects.create_user(
            username='workflow-other-cashier',
            password='Strong-Test-Other-2026!',
            role=User.Role.CASHIER,
        )
        self.supplier = Supplier.objects.create(name='Papeterie Integration')
        self.product = Product.objects.create(
            name='Cahier FIFO Integration',
            barcode='WORKFLOW-FIFO-0001',
            purchase_price=Decimal('0.00'),
            sale_price_ht=Decimal('0.00'),
            tva=Decimal('20.00'),
            stock=0,
            min_stock=2,
            supplier=self.supplier,
        )

    def _as(self, user):
        self.client.force_authenticate(user=user)

    def _create_sent_order(self, quantity, unit_cost, sale_price):
        self._as(self.admin)
        created = self.client.post(
            '/api/inventory/purchase-orders/',
            {
                'supplier': self.supplier.pk,
                'items': [{
                    'product': self.product.pk,
                    'quantity': quantity,
                    'unit_cost': str(unit_cost),
                    'sale_price': str(sale_price),
                }],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        order = PurchaseOrder.objects.get(pk=created.data['id'])
        sent = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/send/',
            {},
            format='json',
        )
        self.assertEqual(sent.status_code, status.HTTP_200_OK, sent.data)
        order.refresh_from_db()
        self.assertEqual(order.status, PurchaseOrder.OrderStatus.SENT)
        return order, order.items.get()

    def _receive_order(
        self,
        order,
        item,
        receipt_id,
        quantity,
        unit_cost,
        sale_price,
    ):
        self._as(self.admin)
        payload = {
            'receipt_id': receipt_id,
            'items': [{
                'item_id': item.pk,
                'quantity': quantity,
                'unit_cost': str(unit_cost),
                'update_purchase_price': True,
                'new_sale_price': str(sale_price),
                'update_sale_price': True,
            }],
        }
        response = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/receive/',
            payload,
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(response.data['idempotent_replay'])
        self.assertTrue(response.data['idempotency_protected'])
        return payload, response

    def _sell(
        self,
        user,
        quantity,
        expected_total,
        amount_received,
        *,
        idempotency_key=None,
        discount_code=None,
        payment_method=Sale.PaymentMethod.CASH,
    ):
        self._as(user)
        payload = {
            'items': [{
                'product_id': self.product.pk,
                'quantity': quantity,
            }],
            'payment_method': payment_method,
            'amount_received': str(amount_received),
            'expected_total': str(expected_total),
        }
        if idempotency_key:
            payload['idempotency_key'] = idempotency_key
        if discount_code:
            payload['discount_code'] = discount_code
        response = self.client.post(
            '/api/sales/sales/',
            payload,
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return payload, Sale.objects.get(pk=response.data['id'])

    def _active_layers(self):
        return list(
            ProductCostLayer.objects.filter(
                product=self.product,
                remaining_quantity__gt=0,
            )
            .order_by('created_at', 'id')
            .values_list(
                'remaining_quantity',
                'unit_cost',
                'sale_price',
            )
        )

    def _assert_inventory(self, stock, layers):
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock)
        self.assertEqual(self._active_layers(), layers)
        self.assertEqual(ProductCostLayer.invariant_delta(self.product), 0)

    def _paginated_results(self, response):
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return response.data.get('results', response.data)

    def test_two_purchase_orders_fifo_sales_discounts_return_and_reports(self):
        # Promotions are created by the administrator, then safely usable at POS.
        self._as(self.admin)
        percentage_response = self.client.post(
            '/api/sales/discounts/',
            {
                'name': 'Reduction integration 10%',
                'code': 'WORKFLOW10',
                'discount_type': Discount.DiscountType.PERCENTAGE,
                'value': '10.00',
                'active': True,
            },
            format='json',
        )
        fixed_response = self.client.post(
            '/api/sales/discounts/',
            {
                'name': 'Reduction integration 5 DH',
                'code': 'WORKFLOW5',
                'discount_type': Discount.DiscountType.FIXED,
                'value': '5.00',
                'active': True,
            },
            format='json',
        )
        self.assertEqual(percentage_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(fixed_response.status_code, status.HTTP_201_CREATED)

        # A cashier cannot see or mutate supplier orders.
        self._as(self.cashier)
        forbidden_orders = self.client.get('/api/inventory/purchase-orders/')
        self.assertEqual(forbidden_orders.status_code, status.HTTP_403_FORBIDDEN)

        # First supplier order and receipt: 10 @ cost 10 / sale 20.
        order_1, order_item_1 = self._create_sent_order(
            10, Decimal('10.00'), Decimal('20.00'),
        )
        receipt_1_payload, receipt_1 = self._receive_order(
            order_1,
            order_item_1,
            'receipt-workflow-0001',
            10,
            Decimal('10.00'),
            Decimal('20.00'),
        )
        self.assertEqual(receipt_1.data['order']['status'], PurchaseOrder.OrderStatus.RECEIVED)
        self.assertEqual(order_1.total_amount, Decimal('100.00'))
        self._assert_inventory(
            10,
            [(10, Decimal('10.00'), Decimal('20.00'))],
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.purchase_price, Decimal('10.00'))
        self.assertEqual(self.product.sale_price_ht, Decimal('20.00'))
        self.assertEqual(self.product.price_ttc, Decimal('20.00'))
        self.assertEqual(self.product.stock_value, Decimal('100.00'))
        self.assertEqual(self.product.profit_margin, Decimal('10.00'))

        # Replaying the same receipt is a no-op; changing its content conflicts.
        receipt_replay = self.client.post(
            f'/api/inventory/purchase-orders/{order_1.pk}/receive/',
            receipt_1_payload,
            format='json',
        )
        self.assertEqual(receipt_replay.status_code, status.HTTP_200_OK)
        self.assertTrue(receipt_replay.data['idempotent_replay'])
        conflicting_receipt = {
            **receipt_1_payload,
            'items': [{**receipt_1_payload['items'][0], 'quantity': 9}],
        }
        receipt_conflict = self.client.post(
            f'/api/inventory/purchase-orders/{order_1.pk}/receive/',
            conflicting_receipt,
            format='json',
        )
        self.assertEqual(receipt_conflict.status_code, status.HTTP_409_CONFLICT)
        self._assert_inventory(
            10,
            [(10, Decimal('10.00'), Decimal('20.00'))],
        )

        # Sale A by cashier: 3 * 20 = 60; FIFO cost 30.
        sale_a_payload, sale_a = self._sell(
            self.cashier,
            3,
            Decimal('60.00'),
            Decimal('100.00'),
            idempotency_key='sale-workflow-0001',
        )
        self.assertEqual(sale_a.total_ttc, Decimal('60.00'))
        self.assertEqual(sale_a.discount_amount, Decimal('0.00'))
        self.assertEqual(sale_a.discount_code, '')
        self.assertEqual(sale_a.change_amount, Decimal('40.00'))
        self.assertEqual(sale_a.items.get().total_purchase_cost, Decimal('30.00'))
        self._assert_inventory(
            7,
            [(7, Decimal('10.00'), Decimal('20.00'))],
        )

        # Idempotent POS replay cannot decrement stock or create a second sale.
        sale_a_replay = self.client.post(
            '/api/sales/sales/', sale_a_payload, format='json',
        )
        self.assertEqual(sale_a_replay.status_code, status.HTTP_200_OK)
        self.assertEqual(sale_a_replay.data['id'], sale_a.pk)
        self.assertEqual(Sale.objects.count(), 1)
        self._assert_inventory(
            7,
            [(7, Decimal('10.00'), Decimal('20.00'))],
        )
        sale_a_conflict_payload = {
            **sale_a_payload,
            'items': [{'product_id': self.product.pk, 'quantity': 4}],
        }
        sale_a_conflict = self.client.post(
            '/api/sales/sales/', sale_a_conflict_payload, format='json',
        )
        self.assertEqual(sale_a_conflict.status_code, status.HTTP_409_CONFLICT)

        # Sale B by cashier: 2 * 20 less 10% = 36; FIFO cost 20.
        _payload_b, sale_b = self._sell(
            self.cashier,
            2,
            Decimal('36.00'),
            Decimal('50.00'),
            discount_code='workflow10',
        )
        self.assertEqual(sale_b.total_ttc, Decimal('36.00'))
        self.assertEqual(sale_b.discount_amount, Decimal('4.00'))
        self.assertEqual(sale_b.discount_code, 'WORKFLOW10')
        self.assertEqual(sale_b.change_amount, Decimal('14.00'))
        self.assertEqual(sale_b.items.get().total_purchase_cost, Decimal('20.00'))
        self._assert_inventory(
            5,
            [(5, Decimal('10.00'), Decimal('20.00'))],
        )

        # Second supplier order changes the current sale price for every unit,
        # while preserving the acquisition cost of the older FIFO lot.
        order_2, order_item_2 = self._create_sent_order(
            8, Decimal('12.00'), Decimal('25.00'),
        )
        receipt_2_payload, _receipt_2 = self._receive_order(
            order_2,
            order_item_2,
            'receipt-workflow-0002',
            8,
            Decimal('12.00'),
            Decimal('25.00'),
        )
        self.assertEqual(order_2.total_amount, Decimal('96.00'))
        self._assert_inventory(
            13,
            [
                (5, Decimal('10.00'), Decimal('25.00')),
                (8, Decimal('12.00'), Decimal('25.00')),
            ],
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.purchase_price, Decimal('12.00'))
        self.assertEqual(self.product.sale_price_ht, Decimal('25.00'))
        self.assertEqual(self.product.price_ttc, Decimal('25.00'))
        self.assertEqual(PriceHistory.objects.filter(product=self.product).count(), 2)

        # A cashier sees sale-safe prices and stock, never costs or margins.
        self._as(self.cashier)
        pos_response = self.client.get(
            f'/api/inventory/products/pos/?barcode={self.product.barcode}'
        )
        pos_products = self._paginated_results(pos_response)
        self.assertEqual(len(pos_products), 1)
        pos_product = pos_products[0]
        self.assertEqual(Decimal(pos_product['price_ttc']), Decimal('25.00'))
        self.assertEqual(
            [
                (row['remaining_quantity'], Decimal(row['sale_price']))
                for row in pos_product['price_layers']
            ],
            [(5, Decimal('25.00')), (8, Decimal('25.00'))],
        )
        for confidential_field in (
            'purchase_price',
            'profit_margin',
            'profit_percentage',
            'stock_value',
            'cost_layers',
        ):
            self.assertNotIn(confidential_field, pos_product)

        # Sale C crosses both cost lots, but all 7 units use the current 25 DH:
        # revenue = 175; FIFO cost = 5*10 + 2*12 = 74.
        _payload_c, sale_c = self._sell(
            self.admin,
            7,
            Decimal('175.00'),
            Decimal('175.00'),
        )
        self.assertEqual(sale_c.total_ttc, Decimal('175.00'))
        self.assertEqual(sale_c.items.count(), 2)
        self.assertEqual(
            list(
                sale_c.items.order_by('id').values_list(
                    'quantity', 'unit_price_ht', 'total_purchase_cost',
                )
            ),
            [
                (5, Decimal('25.00'), Decimal('50.00')),
                (2, Decimal('25.00'), Decimal('24.00')),
            ],
        )
        self._assert_inventory(
            6,
            [(6, Decimal('12.00'), Decimal('25.00'))],
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.price_ttc, Decimal('25.00'))

        # Lowering the catalogue price applies immediately to the unsold lot.
        price_drop = self.client.patch(
            f'/api/inventory/products/{self.product.pk}/',
            {'sale_price_ht': '18.00'},
            format='json',
        )
        self.assertEqual(price_drop.status_code, status.HTTP_200_OK, price_drop.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.price_ttc, Decimal('18.00'))
        self._assert_inventory(
            6,
            [(6, Decimal('12.00'), Decimal('18.00'))],
        )

        # Sale D by cashier: 4*18 less fixed 5 = 67; cost 48.
        sale_d_payload, sale_d = self._sell(
            self.cashier,
            4,
            Decimal('67.00'),
            Decimal('100.00'),
            idempotency_key='sale-workflow-0004',
            discount_code='workflow5',
        )
        self.assertEqual(sale_d.total_ttc, Decimal('67.00'))
        self.assertEqual(sale_d.discount_amount, Decimal('5.00'))
        self.assertEqual(sale_d.discount_code, 'WORKFLOW5')
        self.assertEqual(sale_d.change_amount, Decimal('33.00'))
        self.assertEqual(sale_d.items.get().total_purchase_cost, Decimal('48.00'))
        self._assert_inventory(
            2,
            [(2, Decimal('12.00'), Decimal('18.00'))],
        )

        # Replaying a discounted sale must not consume the promotion twice.
        self._as(self.cashier)
        sale_d_replay = self.client.post(
            '/api/sales/sales/', sale_d_payload, format='json',
        )
        self.assertEqual(sale_d_replay.status_code, status.HTTP_200_OK)
        self.assertEqual(sale_d_replay.data['id'], sale_d.pk)
        self.assertEqual(Sale.objects.count(), 4)
        self.assertEqual(Discount.objects.get(code='WORKFLOW10').uses_count, 1)
        self.assertEqual(Discount.objects.get(code='WORKFLOW5').uses_count, 1)

        # Sales visibility is role-scoped: cashier sees only own sales, admin all.
        cashier_sales = self._paginated_results(
            self.client.get('/api/sales/sales/')
        )
        self.assertEqual({row['id'] for row in cashier_sales}, {
            sale_a.pk, sale_b.pk, sale_d.pk,
        })
        self._as(self.other_cashier)
        other_sales = self._paginated_results(
            self.client.get('/api/sales/sales/')
        )
        self.assertEqual(other_sales, [])
        self._as(self.admin)
        admin_sales = self._paginated_results(
            self.client.get('/api/sales/sales/')
        )
        self.assertEqual({row['id'] for row in admin_sales}, {
            sale_a.pk, sale_b.pk, sale_c.pk, sale_d.pk,
        })

        # A return is administrator-only, idempotent, discounted proportionally,
        # and restores stock exactly once.
        sale_d_item = sale_d.items.get()
        return_payload = {
            'sale': sale_d.pk,
            'reason': 'Retour client integration',
            'idempotency_key': 'return-workflow-0001',
            'items': [{
                'sale_item': sale_d_item.pk,
                'quantity': 1,
                'restock': True,
            }],
        }
        self._as(self.cashier)
        forbidden_return = self.client.post(
            '/api/sales/returns/', return_payload, format='json',
        )
        self.assertEqual(forbidden_return.status_code, status.HTTP_403_FORBIDDEN)

        self._as(self.admin)
        created_return = self.client.post(
            '/api/sales/returns/', return_payload, format='json',
        )
        self.assertEqual(created_return.status_code, status.HTTP_201_CREATED, created_return.data)
        self.assertEqual(
            Decimal(created_return.data['refund_amount']), Decimal('16.75')
        )
        return_order = Return.objects.get(pk=created_return.data['id'])
        sale_after_return = self.client.get(f'/api/sales/sales/{sale_d.pk}/')
        self.assertEqual(sale_after_return.status_code, status.HTTP_200_OK)
        self.assertEqual(
            sale_after_return.data['items'][0]['returnable_quantity'],
            3,
        )
        self._assert_inventory(
            2,
            [(2, Decimal('12.00'), Decimal('18.00'))],
        )

        replayed_return = self.client.post(
            '/api/sales/returns/', return_payload, format='json',
        )
        self.assertEqual(replayed_return.status_code, status.HTTP_200_OK)
        self.assertEqual(replayed_return.data['id'], return_order.pk)
        conflicting_return = self.client.post(
            '/api/sales/returns/',
            {
                **return_payload,
                'items': [{
                    'sale_item': sale_d_item.pk,
                    'quantity': 2,
                    'restock': True,
                }],
            },
            format='json',
        )
        self.assertEqual(conflicting_return.status_code, status.HTTP_409_CONFLICT)

        approve_url = f'/api/sales/returns/{return_order.pk}/approve/'
        approved = self.client.post(approve_url, {}, format='json')
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        duplicate_approval = self.client.post(approve_url, {}, format='json')
        self.assertEqual(duplicate_approval.status_code, status.HTTP_409_CONFLICT)
        self._assert_inventory(
            3,
            [
                (2, Decimal('12.00'), Decimal('18.00')),
                (1, Decimal('12.00'), Decimal('18.00')),
            ],
        )

        complete_url = f'/api/sales/returns/{return_order.pk}/complete/'
        completed = self.client.post(complete_url, {}, format='json')
        self.assertEqual(completed.status_code, status.HTTP_200_OK)
        duplicate_completion = self.client.post(complete_url, {}, format='json')
        self.assertEqual(duplicate_completion.status_code, status.HTTP_409_CONFLICT)

        # Stock valuation uses FIFO cost 12; current margin uses sale price 18.
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_value, Decimal('36.00'))
        self.assertEqual(self.product.profit_margin, Decimal('6.00'))
        self.assertEqual(
            Decimal(self.product.profit_percentage).quantize(Decimal('0.01')),
            Decimal('50.00'),
        )

        # The canonical accounting aggregate, report builder and HTTP report
        # must all expose the same financial truth.
        today = timezone.localdate()
        financials = financials_for_period(today, today)
        self.assertEqual(financials, {
            'gross_revenue': Decimal('338.00'),
            'refunds': Decimal('16.75'),
            'net_revenue': Decimal('321.25'),
            'gross_cost': Decimal('172.00'),
            'returned_cost': Decimal('12.00'),
            'net_cost': Decimal('160.00'),
            'gross_margin': Decimal('161.25'),
            'sales_count': 4,
            'returns_count': 1,
        })

        report = get_report_data(today, today)
        expected_report_money = {
            'gross_revenue': Decimal('338.00'),
            'total_returns': Decimal('16.75'),
            'total_revenue': Decimal('321.25'),
            'gross_cost': Decimal('172.00'),
            'returned_cost': Decimal('12.00'),
            'net_cost': Decimal('160.00'),
            'gross_margin': Decimal('161.25'),
            'total_profit': Decimal('161.25'),
        }
        for field, expected in expected_report_money.items():
            self.assertEqual(Decimal(str(report[field])), expected, field)
        self.assertEqual(report['total_sales'], 4)
        self.assertEqual(report['returns_count'], 1)
        self.assertEqual(len(report['items_sold']), 1)
        report_product = report['items_sold'][0]
        self.assertEqual(report_product['quantity'], 15)
        self.assertEqual(Decimal(str(report_product['revenue'])), Decimal('321.25'))
        self.assertEqual(Decimal(str(report_product['cost'])), Decimal('160.00'))
        self.assertEqual(Decimal(str(report_product['profit'])), Decimal('161.25'))
        self.assertEqual(
            sum(Decimal(str(point['revenue'])) for point in report['chart_data']),
            Decimal('321.25'),
        )

        daily_response = self.client.get(
            f'/api/reporting/daily/?date={today.isoformat()}'
        )
        self.assertEqual(daily_response.status_code, status.HTTP_200_OK)
        for field, expected in expected_report_money.items():
            self.assertEqual(
                Decimal(str(daily_response.data[field])), expected, field,
            )
        stats_response = self.client.get('/api/reporting/stats/?days=7')
        self.assertEqual(stats_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            Decimal(str(stats_response.data['today']['revenue'])),
            Decimal('321.25'),
        )
        self.assertEqual(stats_response.data['today']['sales_count'], 4)

        self._as(self.cashier)
        self.assertEqual(
            self.client.get('/api/reporting/daily/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

        # Final audit trail: two receipts, four physical sale outputs and one
        # stock-restoring return, with the exact stock sequence.
        self.assertEqual(PurchaseReceipt.objects.count(), 2)
        movements = list(
            StockMovement.objects.filter(product=self.product)
            .order_by('id')
            .values_list(
                'movement_type', 'quantity', 'stock_before', 'stock_after',
            )
        )
        self.assertEqual(movements, [
            (StockMovement.MovementType.IN, 10, 0, 10),
            (StockMovement.MovementType.OUT, 3, 10, 7),
            (StockMovement.MovementType.OUT, 2, 7, 5),
            (StockMovement.MovementType.IN, 8, 5, 13),
            (StockMovement.MovementType.OUT, 7, 13, 6),
            (StockMovement.MovementType.OUT, 4, 6, 2),
            (StockMovement.MovementType.RETURN, 1, 2, 3),
        ])

        # Receipt replay was a true no-op, including the second order payload.
        self._as(self.admin)
        replay_2 = self.client.post(
            f'/api/inventory/purchase-orders/{order_2.pk}/receive/',
            receipt_2_payload,
            format='json',
        )
        self.assertEqual(replay_2.status_code, status.HTTP_200_OK)
        self.assertTrue(replay_2.data['idempotent_replay'])
        self._assert_inventory(
            3,
            [
                (2, Decimal('12.00'), Decimal('18.00')),
                (1, Decimal('12.00'), Decimal('18.00')),
            ],
        )

    def test_invalid_operations_are_rejected_without_stock_or_fifo_drift(self):
        order, item = self._create_sent_order(
            10, Decimal('10.00'), Decimal('20.00'),
        )

        # Invalid or excessive receipts leave the SENT order untouched.
        bad_key = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/receive/',
            {
                'receipt_id': 'bad key',
                'items': [{'item_id': item.pk, 'quantity': 1}],
            },
            format='json',
        )
        self.assertEqual(bad_key.status_code, status.HTTP_400_BAD_REQUEST)
        over_receipt = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/receive/',
            {
                'receipt_id': 'receipt-over-0001',
                'items': [{
                    'item_id': item.pk,
                    'quantity': 11,
                    'unit_cost': '10.00',
                    'new_sale_price': '20.00',
                }],
            },
            format='json',
        )
        self.assertEqual(over_receipt.status_code, status.HTTP_400_BAD_REQUEST)
        order.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(order.status, PurchaseOrder.OrderStatus.SENT)
        self.assertEqual(item.received_quantity, 0)
        self._assert_inventory(0, [])
        self.assertEqual(StockMovement.objects.count(), 0)
        self.assertEqual(PurchaseReceipt.objects.count(), 0)

        valid_payload, _valid_receipt = self._receive_order(
            order,
            item,
            'receipt-errors-0001',
            10,
            Decimal('10.00'),
            Decimal('20.00'),
        )
        self._assert_inventory(
            10,
            [(10, Decimal('10.00'), Decimal('20.00'))],
        )

        # The same receipt key with a different payload is a conflict.
        conflict_payload = {
            **valid_payload,
            'items': [{**valid_payload['items'][0], 'quantity': 9}],
        }
        conflict = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/receive/',
            conflict_payload,
            format='json',
        )
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)

        # A fully received order cannot be received again with another key.
        second_receipt = self.client.post(
            f'/api/inventory/purchase-orders/{order.pk}/receive/',
            {
                **valid_payload,
                'receipt_id': 'receipt-errors-0002',
            },
            format='json',
        )
        self.assertEqual(second_receipt.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(PurchaseReceipt.objects.count(), 1)

        def assert_no_sale_side_effect():
            self.assertEqual(Sale.objects.count(), 0)
            self._assert_inventory(
                10,
                [(10, Decimal('10.00'), Decimal('20.00'))],
            )
            self.assertEqual(
                StockMovement.objects.filter(
                    movement_type=StockMovement.MovementType.OUT,
                ).count(),
                0,
            )

        self._as(self.cashier)

        # A cashier cannot invent a free-form discount.
        free_discount = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 1}],
                'discount_amount': '1.00',
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '20.00',
            },
            format='json',
        )
        self.assertEqual(free_discount.status_code, status.HTTP_400_BAD_REQUEST)
        assert_no_sale_side_effect()

        # A stale client total rolls the already-prepared FIFO consumption back.
        stale_total = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 2}],
                'expected_total': '39.00',
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '40.00',
                'idempotency_key': 'sale-errors-stale-001',
            },
            format='json',
        )
        self.assertEqual(stale_total.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(stale_total.data['server_total'], '40.00')
        assert_no_sale_side_effect()

        insufficient_cash = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 1}],
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '19.99',
            },
            format='json',
        )
        self.assertEqual(insufficient_cash.status_code, status.HTTP_400_BAD_REQUEST)
        assert_no_sale_side_effect()

        wrong_card_amount = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 1}],
                'payment_method': Sale.PaymentMethod.CARD,
                'amount_received': '21.00',
            },
            format='json',
        )
        self.assertEqual(wrong_card_amount.status_code, status.HTTP_400_BAD_REQUEST)
        assert_no_sale_side_effect()

        invalid_discount = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 1}],
                'discount_code': 'DOES-NOT-EXIST',
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '20.00',
            },
            format='json',
        )
        self.assertEqual(invalid_discount.status_code, status.HTTP_400_BAD_REQUEST)
        assert_no_sale_side_effect()

        oversell = self.client.post(
            '/api/sales/sales/',
            {
                'items': [{'product_id': self.product.pk, 'quantity': 11}],
                'payment_method': Sale.PaymentMethod.CASH,
                'amount_received': '1000.00',
            },
            format='json',
        )
        self.assertEqual(oversell.status_code, status.HTTP_400_BAD_REQUEST)
        assert_no_sale_side_effect()

        # A successful sale after all rejected attempts proves no hidden drift.
        _payload, sale = self._sell(
            self.cashier,
            1,
            Decimal('20.00'),
            Decimal('20.00'),
            idempotency_key='sale-errors-valid-001',
        )
        self.assertEqual(sale.items.get().total_purchase_cost, Decimal('10.00'))
        self._assert_inventory(
            9,
            [(9, Decimal('10.00'), Decimal('20.00'))],
        )
