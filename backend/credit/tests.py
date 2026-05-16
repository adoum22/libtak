from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from inventory.models import Product, ProductCostLayer

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

        url = reverse('creditsale-pay', args=[credit.id])
        response = self.client.post(url, {'amount': '15'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        credit.refresh_from_db()
        self.assertEqual(credit.status, CreditSale.Status.PARTIAL)
        self.assertEqual(float(credit.paid_amount), 15.0)

        response = self.client.post(url, {'amount': '25'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        credit.refresh_from_db()
        self.assertEqual(credit.status, CreditSale.Status.PAID)
        self.assertEqual(float(credit.paid_amount), 40.0)
        self.assertEqual(CreditPayment.objects.count(), 2)

    def test_cannot_overpay(self):
        self._create_credit_sale(quantity=2)  # total = 40
        credit = CreditSale.objects.get()
        url = reverse('creditsale-pay', args=[credit.id])
        response = self.client.post(url, {'amount': '999'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

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
        url = reverse('creditsale-pay', args=[credit.id])
        self.client.post(url, {'amount': '20'}, format='json')
        summary = view._summary()
        self.assertEqual(float(summary['cash_sales_total']), 0.0)
        self.assertEqual(float(summary['credit_payments_total']), 20.0)
        self.assertEqual(float(summary['balance']), 20.0)
