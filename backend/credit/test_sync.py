from copy import deepcopy
from decimal import Decimal
from unittest.mock import MagicMock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from core.models import User
from core.sync_api import receive_credits_snapshot
from core.sync_service import (
    SYNC_PROTOCOL,
    SYNC_PROTOCOL_VERSION,
    SyncService,
    make_sync_id,
)
from sales.models import Sale

from .models import CreditPayment, CreditSale, Customer


class CreditSnapshotIntegrityTests(TestCase):
    origin_id = '123e4567-e89b-12d3-a456-426614174000'
    sync_token = 'credit-sync-test-token'

    def setUp(self):
        self.user = User.objects.create_user(
            username='credit-sync-admin',
            password='Strongpassw0rd!',
            role=User.Role.ADMIN,
        )
        self.sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('20.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('20.00'),
            payment_method=Sale.PaymentMethod.CREDIT,
        )
        self.sale.local_sync_id = make_sync_id(
            self.origin_id, 'sale', self.sale.id,
        )
        self.sale.save(update_fields=['local_sync_id'])
        customer = Customer.objects.create(name='Client synchronisé')
        credit = CreditSale.objects.create(
            sale=self.sale,
            customer=customer,
            status=CreditSale.Status.UNPAID,
            paid_amount=Decimal('0.00'),
        )
        CreditPayment.objects.create(
            credit_sale=credit,
            amount=Decimal('20.00'),
            note='Règlement annulé',
            created_by=self.user,
            operation_id='payment-sync-0001',
            operation_payload_hash='a' * 64,
            status=CreditPayment.PaymentStatus.REVERSED,
            reversed_by=self.user,
            reversed_at=timezone.now(),
            reversal_reason='Mauvais client',
            reversal_operation_id='reversal-sync-0001',
            reversal_payload_hash='b' * 64,
        )

    def _snapshot_payload(self):
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = {
            'protocol': SYNC_PROTOCOL,
            'protocol_version': SYNC_PROTOCOL_VERSION,
            'origin_id': self.origin_id,
            'status': 'success',
            'customers_imported': 1,
            'credit_sales_imported': 1,
            'credit_payments_imported': 1,
        }
        http_client = MagicMock()
        http_client.post.return_value = response
        service = SyncService(
            cloud_url='https://cloud.example.test',
            sync_token=self.sync_token,
            origin_id=self.origin_id,
            http_client=http_client,
        )

        result = service.push_credits_snapshot(self.origin_id)

        self.assertEqual(result['status'], 'success')
        return http_client.post.call_args.kwargs['json']

    @override_settings(SYNC_TOKEN=sync_token)
    def test_reversal_metadata_survives_credit_snapshot_round_trip(self):
        payload = self._snapshot_payload()
        exported_payment = payload['credit_payments'][0]
        self.assertEqual(exported_payment['status'], 'REVERSED')
        self.assertEqual(
            exported_payment['reversal_operation_id'],
            'reversal-sync-0001',
        )

        malformed_payload = deepcopy(payload)
        malformed_payload['credit_payments'][0]['reversal_reason'] = ''
        malformed_request = APIRequestFactory().post(
            '/api/auth/sync/credits/',
            malformed_payload,
            format='json',
            HTTP_AUTHORIZATION=f'SyncToken {self.sync_token}',
        )
        malformed_response = receive_credits_snapshot(malformed_request)
        self.assertEqual(malformed_response.status_code, 400)
        self.assertEqual(CreditPayment.objects.count(), 1)

        request = APIRequestFactory().post(
            '/api/auth/sync/credits/',
            payload,
            format='json',
            HTTP_AUTHORIZATION=f'SyncToken {self.sync_token}',
        )
        response = receive_credits_snapshot(request)

        self.assertEqual(response.status_code, 200, response.data)
        payment = CreditPayment.objects.get()
        credit = CreditSale.objects.get()
        self.assertEqual(payment.status, CreditPayment.PaymentStatus.REVERSED)
        self.assertEqual(payment.operation_id, 'payment-sync-0001')
        self.assertEqual(payment.operation_payload_hash, 'a' * 64)
        self.assertEqual(payment.reversal_reason, 'Mauvais client')
        self.assertEqual(payment.reversal_operation_id, 'reversal-sync-0001')
        self.assertEqual(payment.reversal_payload_hash, 'b' * 64)
        self.assertEqual(payment.reversed_by, self.user)
        self.assertIsNotNone(payment.reversed_at)
        self.assertEqual(credit.paid_amount, Decimal('0.00'))
        self.assertEqual(credit.status, CreditSale.Status.UNPAID)
