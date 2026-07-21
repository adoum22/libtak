from decimal import Decimal

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import User
from sales.models import Discount


class DiscountCodeIntegrityAPITests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='discount-code-admin',
            password='Strong-Discount-Code-2026!',
            role=User.Role.ADMIN,
        )
        self.client.force_authenticate(self.admin)

    def _create(self, code):
        return self.client.post(
            '/api/sales/discounts/',
            {
                'name': f'Remise {code}',
                'code': code,
                'discount_type': Discount.DiscountType.PERCENTAGE,
                'value': '10.00',
            },
            format='json',
        )

    def test_api_normalizes_code_and_rejects_case_variant_without_server_error(self):
        created = self._create('  promo10  ')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(created.data['code'], 'PROMO10')

        duplicate = self._create('PrOmO10')
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('code', duplicate.data)
        self.assertEqual(Discount.objects.filter(code='PROMO10').count(), 1)

        applied = self.client.post(
            '/api/sales/discounts/apply/',
            {'code': 'promo10', 'subtotal': '20.00'},
            format='json',
        )
        self.assertEqual(applied.status_code, status.HTTP_200_OK, applied.data)
        self.assertEqual(applied.data['discount']['code'], 'PROMO10')
        self.assertEqual(applied.data['discount_amount'], Decimal('2.00'))

    def test_database_constraint_blocks_case_variant_for_non_api_writes(self):
        Discount.objects.create(
            name='Premiere',
            code='DIRECT10',
            discount_type=Discount.DiscountType.FIXED,
            value=Decimal('1.00'),
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            Discount.objects.create(
                name='Deuxieme',
                code='direct10',
                discount_type=Discount.DiscountType.FIXED,
                value=Decimal('1.00'),
            )


class DiscountCodeDataMigrationTests(TransactionTestCase):
    migrate_from = [('sales', '0008_discount_constraints')]
    migrate_to = [('sales', '0009_discount_code_case_insensitive')]

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        old_apps = executor.loader.project_state(self.migrate_from).apps
        OldDiscount = old_apps.get_model('sales', 'Discount')
        self.primary_id = OldDiscount.objects.create(
            name='Promotion active',
            code=' promo ',
            discount_type='FIXED',
            value=Decimal('1.00'),
            active=True,
            uses_count=3,
        ).pk
        self.duplicate_id = OldDiscount.objects.create(
            name='Ancien doublon',
            code='PROMO',
            discount_type='FIXED',
            value=Decimal('2.00'),
            active=False,
            uses_count=0,
        ).pk

        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_to)
        self.apps = executor.loader.project_state(self.migrate_to).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.migrate_to)
        super().tearDown()

    def test_legacy_case_duplicates_are_preserved_disambiguated_and_safe(self):
        MigratedDiscount = self.apps.get_model('sales', 'Discount')
        primary = MigratedDiscount.objects.get(pk=self.primary_id)
        duplicate = MigratedDiscount.objects.get(pk=self.duplicate_id)

        self.assertEqual(primary.code, 'PROMO')
        self.assertTrue(primary.active)
        self.assertTrue(duplicate.code.startswith('PROMO-DUP-'))
        self.assertFalse(duplicate.active)

        codes = list(MigratedDiscount.objects.exclude(code__isnull=True).values_list(
            'code', flat=True,
        ))
        self.assertEqual(len(codes), len({code.casefold() for code in codes}))
        with self.assertRaises(IntegrityError), transaction.atomic():
            MigratedDiscount.objects.create(
                name='Collision tardive',
                code='promo',
                discount_type='FIXED',
                value=Decimal('1.00'),
            )
