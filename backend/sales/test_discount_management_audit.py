from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from core.models import AuditLog, User
from sales.models import Discount


class DiscountManagementAuditTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='discount-audit-admin',
            password='Strong-Discount-Audit-2026!',
            role=User.Role.ADMIN,
        )
        self.client.force_authenticate(self.admin)

    def test_crud_is_audited_and_used_discount_must_be_deactivated(self):
        created = self.client.post(
            '/api/sales/discounts/',
            {
                'name': 'Audit remise',
                'code': 'AUDIT10',
                'discount_type': Discount.DiscountType.PERCENTAGE,
                'value': '10.00',
                'min_purchase': '20.00',
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        discount_id = created.data['id']

        updated = self.client.patch(
            f'/api/sales/discounts/{discount_id}/',
            {'active': False},
            format='json',
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK, updated.data)
        self.assertEqual(
            AuditLog.objects.filter(
                model_name='Discount',
                object_id=str(discount_id),
            ).count(),
            2,
        )
        Discount.objects.filter(pk=discount_id).update(uses_count=1, active=True)
        refused_delete = self.client.delete(
            f'/api/sales/discounts/{discount_id}/'
        )
        self.assertEqual(refused_delete.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(Discount.objects.filter(pk=discount_id).exists())

        deactivated = self.client.patch(
            f'/api/sales/discounts/{discount_id}/',
            {'active': False},
            format='json',
        )
        self.assertEqual(deactivated.status_code, status.HTTP_200_OK)

    def test_unused_discount_can_be_deleted_with_audit_record(self):
        discount = Discount.objects.create(
            name='Jamais utilisee',
            code='UNUSED5',
            discount_type=Discount.DiscountType.FIXED,
            value=Decimal('5.00'),
        )

        response = self.client.delete(f'/api/sales/discounts/{discount.pk}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Discount.objects.filter(pk=discount.pk).exists())
        self.assertTrue(
            AuditLog.objects.filter(
                model_name='Discount',
                object_id=str(discount.pk),
                action=AuditLog.ActionType.DELETE,
            ).exists()
        )
