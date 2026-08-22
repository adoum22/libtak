import base64
import builtins
import hashlib
import json
import os
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal
from datetime import date, datetime, time, timedelta
from django.utils import timezone

from inventory.models import Product
from sales.models import Return, ReturnItem, Sale, SaleItem
from .models import ReportSettings, ReportLog, ScheduledJobClaim
from .tasks import (
    daily_database_backup,
    email_config_error,
    get_report_data,
    send_report_email,
)
from .backup_utils import (
    BackupValidationError,
    decrypt_archive,
    validate_zip_archive,
)
from io import StringIO

User = get_user_model()


class ReportSettingsTest(TestCase):
    """Tests pour ReportSettings (singleton)"""

    def test_singleton_pattern(self):
        """Test qu'il n'y a qu'une seule instance de ReportSettings"""
        settings1 = ReportSettings.get_settings()
        settings1.daily_enabled = True
        settings1.save()

        settings2 = ReportSettings.get_settings()
        self.assertEqual(settings1.pk, settings2.pk)
        self.assertEqual(settings1.pk, 1)

    def test_recipients_list(self):
        """Test parsing de la liste des destinataires"""
        settings = ReportSettings.get_settings()
        settings.email_recipients = 'test1@email.com, test2@email.com, test3@email.com'
        settings.save()

        recipients = settings.get_recipients_list()
        self.assertEqual(len(recipients), 3)
        self.assertIn('test1@email.com', recipients)


class ReportEmailConfigTest(TestCase):
    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend',
        EMAIL_HOST='smtp.gmail.com',
        EMAIL_HOST_USER='sender@example.com',
        EMAIL_HOST_PASSWORD='secret',
    )
    def test_console_backend_is_reported_as_error(self):
        self.assertIn('console.EmailBackend', email_config_error())
        success, error = send_report_email(
            'DAILY',
            date.today(),
            date.today(),
            {'total_revenue': 0, 'total_profit': 0, 'total_sales': 0, 'items_sold': []},
            ['recipient@example.com'],
        )
        self.assertFalse(success)
        self.assertIn('console.EmailBackend', error)

    def test_scheduled_command_reports_missing_recipients(self):
        ReportSettings.get_settings().save()
        out = StringIO()

        with self.assertRaises(CommandError):
            call_command(
                'send_scheduled_reports', '--skip-backup', '--force-all', stdout=out,
            )

        self.assertIn('X daily report: No recipients configured', out.getvalue())

    def test_scheduled_backup_failure_returns_nonzero_and_remains_retryable(self):
        today = timezone.localdate()
        report_settings = ReportSettings.get_settings()
        report_settings.daily_enabled = False
        report_settings.weekly_enabled = False
        report_settings.monthly_enabled = False
        report_settings.quarterly_enabled = False
        report_settings.yearly_enabled = False
        report_settings.low_stock_last_sent_on = today
        report_settings.save()

        with patch(
            'reporting.management.commands.send_scheduled_reports.daily_database_backup',
            return_value='Backup failed: simulated storage failure',
        ):
            with self.assertRaises(CommandError):
                call_command('send_scheduled_reports')

        claim = ScheduledJobClaim.objects.get(job_name='BACKUP', run_date=today)
        self.assertEqual(claim.status, ScheduledJobClaim.Status.FAILED)
        report_settings.refresh_from_db()
        self.assertIsNone(report_settings.backup_last_sent_on)

    def test_scheduler_claim_prevents_duplicate_successful_send(self):
        today = timezone.localdate()
        report_settings = ReportSettings.get_settings()
        report_settings.daily_enabled = True
        report_settings.weekly_enabled = False
        report_settings.monthly_enabled = False
        report_settings.quarterly_enabled = False
        report_settings.yearly_enabled = False
        report_settings.low_stock_last_sent_on = today
        report_settings.save()

        target = 'reporting.management.commands.send_scheduled_reports.send_daily_report'
        with patch(target, return_value='Daily report sent successfully') as sender:
            call_command('send_scheduled_reports', '--force-all', '--skip-backup')
            call_command('send_scheduled_reports', '--force-all', '--skip-backup')

        self.assertEqual(sender.call_count, 1)
        report_settings.refresh_from_db()
        self.assertEqual(report_settings.daily_last_sent_on, today)
        claim = ScheduledJobClaim.objects.get(job_name='DAILY', run_date=today)
        self.assertEqual(claim.status, ScheduledJobClaim.Status.SUCCESS)

    def test_daily_slot_ignores_clock_times_but_preserves_report_dates(self):
        report_settings = ReportSettings.get_settings()
        report_settings.daily_enabled = True
        report_settings.daily_time = time(23, 59)
        report_settings.weekly_enabled = True
        report_settings.weekly_day = 2  # Wednesday
        report_settings.weekly_time = time(23, 59)
        report_settings.monthly_enabled = True
        report_settings.monthly_time = time(23, 59)
        report_settings.quarterly_enabled = True
        report_settings.quarterly_time = time(23, 59)
        report_settings.yearly_enabled = True
        report_settings.yearly_time = time(23, 59)
        report_settings.save()

        fixed_now = timezone.make_aware(datetime(2025, 12, 31, 8, 0))
        out = StringIO()
        with patch(
            'reporting.management.commands.send_scheduled_reports.timezone.localtime',
            return_value=fixed_now,
        ):
            call_command(
                'send_scheduled_reports',
                '--daily-slot',
                '--dry-run',
                '--skip-backup',
                stdout=out,
            )

        output = out.getvalue()
        for label in (
            'daily report',
            'weekly report',
            'monthly report',
            'quarterly report',
            'yearly report',
            'low stock alert',
        ):
            self.assertIn(f'[dry-run] due: {label}', output)


class EncryptedBackupTest(TestCase):
    def test_backup_is_encrypted_restorable_and_detects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            media_dir = root / 'media'
            media_dir.mkdir()
            (media_dir / 'proof.txt').write_text('media preserved', encoding='utf-8')
            source_db = root / 'source.sqlite3'
            with closing(sqlite3.connect(source_db)) as connection:
                connection.execute('CREATE TABLE django_migrations (id INTEGER)')
                connection.execute('CREATE TABLE core_user (id INTEGER)')
                connection.execute('CREATE TABLE proof (value TEXT)')
                connection.execute("INSERT INTO proof VALUES ('database preserved')")
                connection.commit()
            key = base64.urlsafe_b64encode(b'b' * 32).decode('ascii')
            database_settings = {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': source_db,
                },
            }

            with override_settings(
                DATABASES=database_settings,
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_ENCRYPTION_KEY': key,
            }), patch('reporting.tasks.ReportLog.objects.create'):
                result = str(daily_database_backup())

            self.assertTrue(result.startswith('Backup created: '), result)
            encrypted = Path(result.split(': ', 1)[1])
            self.assertEqual(encrypted.suffix, '.ltbk')
            self.assertEqual(encrypted.read_bytes()[:5], b'LTBK1')
            self.assertEqual(list(backup_dir.glob('*.sqlite3')), [])

            decrypted = root / 'backup.zip'
            with patch.dict(os.environ, {'BACKUP_ENCRYPTION_KEY': key}):
                decrypt_archive(encrypted, decrypted)
            manifest = validate_zip_archive(decrypted)
            self.assertIn('database.sqlite3', manifest['files_sha256'])
            self.assertIn('media/proof.txt', manifest['files_sha256'])

            altered = bytearray(encrypted.read_bytes())
            altered[len(altered) // 2] ^= 1
            tampered = root / 'tampered.ltbk'
            tampered.write_bytes(altered)
            with patch.dict(os.environ, {'BACKUP_ENCRYPTION_KEY': key}):
                with self.assertRaises(BackupValidationError):
                    decrypt_archive(tampered, root / 'tampered.zip')

    def test_media_manifest_hashes_the_bytes_written_to_the_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            media_dir = root / 'media'
            media_dir.mkdir()
            media_file = media_dir / 'changing.bin'
            media_file.write_bytes(b'before-backup')
            source_db = root / 'source.sqlite3'
            with closing(sqlite3.connect(source_db)) as connection:
                connection.execute('CREATE TABLE django_migrations (id INTEGER)')
                connection.execute('CREATE TABLE core_user (id INTEGER)')
                connection.commit()

            key = base64.urlsafe_b64encode(b'c' * 32).decode('ascii')
            database_settings = {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': source_db,
                },
            }
            original_path_open = Path.open
            mutation_seen = False

            def mutate_before_media_read(path, *args, **kwargs):
                nonlocal mutation_seen
                mode = args[0] if args else kwargs.get('mode', 'r')
                if path == media_file and 'r' in mode and not mutation_seen:
                    with builtins.open(media_file, 'wb') as stream:
                        stream.write(b'changed-during-backup')
                    mutation_seen = True
                return original_path_open(path, *args, **kwargs)

            with override_settings(
                DATABASES=database_settings,
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_OFFSITE_DIR': '',
                'BACKUP_ENCRYPTION_KEY': key,
            }), patch(
                'reporting.tasks.ReportLog.objects.create'
            ), patch('pathlib.Path.open', new=mutate_before_media_read):
                result = str(daily_database_backup())

            self.assertTrue(mutation_seen)
            self.assertTrue(result.startswith('Backup created: '), result)
            encrypted = Path(result.split(': ', 1)[1])
            decrypted = root / 'consistent.zip'
            with patch.dict(os.environ, {'BACKUP_ENCRYPTION_KEY': key}):
                decrypt_archive(encrypted, decrypted)
            validate_zip_archive(decrypted)

    def test_archive_requires_checksums_for_every_member(self):
        with tempfile.TemporaryDirectory() as directory:
            archive_path = Path(directory) / 'unsafe.zip'
            database = b'not a real database'
            manifest = {
                'format': 1,
                'database_engine': 'django.db.backends.sqlite3',
                'files_sha256': {
                    'database.sqlite3': hashlib.sha256(database).hexdigest(),
                },
            }
            with zipfile.ZipFile(archive_path, 'w') as archive:
                archive.writestr('database.sqlite3', database)
                archive.writestr('unexpected.txt', 'not covered')
                archive.writestr('manifest.json', json.dumps(manifest))

            with self.assertRaises(BackupValidationError):
                validate_zip_archive(archive_path)


class ReportDataTest(TestCase):
    """Tests pour la génération des données de rapport"""

    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='test123'
        )
        self.product = Product.objects.create(
            name='Test Product',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('6.00'),
            tva=Decimal('20.00'),
            stock=100
        )

    def test_empty_report(self):
        """Test rapport sans ventes"""
        today = timezone.localdate()
        data = get_report_data(today, today)

        self.assertEqual(data['total_sales'], 0)
        self.assertEqual(data['total_revenue'], 0.0)
        self.assertEqual(data['total_profit'], 0.0)
        self.assertEqual(len(data['items_sold']), 0)

    def test_report_with_sales(self):
        """Test rapport avec ventes"""
        # Créer une vente
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('20.00'),
            total_tva=Decimal('4.00'),
            total_ttc=Decimal('24.00'),
            payment_method='CASH'
        )
        SaleItem.objects.create(
            sale=sale,
            product=self.product,
            product_name=self.product.name,
            quantity=2,
            unit_price_ht=Decimal('10.00'),
            total_price_ht=Decimal('20.00'),
            tva_rate=Decimal('20.00')
        )

        today = timezone.localdate()
        data = get_report_data(today, today)

        self.assertEqual(data['total_sales'], 1)
        # La source comptable autoritaire est le total TTC enregistré.
        self.assertEqual(data['total_revenue'], 24.0)
        self.assertGreater(data['total_profit'], 0)
        self.assertEqual(len(data['items_sold']), 1)

    def test_completed_return_reverses_revenue_and_restocked_cost(self):
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('100.00'),
            total_tva=Decimal('0.00'),
            total_ttc=Decimal('100.00'),
            payment_method=Sale.PaymentMethod.CASH,
        )
        item = SaleItem.objects.create(
            sale=sale,
            product=self.product,
            product_name=self.product.name,
            quantity=2,
            unit_price_ht=Decimal('50.00'),
            total_price_ht=Decimal('100.00'),
            tva_rate=Decimal('0.00'),
            unit_purchase_price=Decimal('30.00'),
            total_purchase_cost=Decimal('60.00'),
        )
        returned = Return.objects.create(
            sale=sale,
            status=Return.ReturnStatus.COMPLETED,
            reason='Retour partiel',
            refund_amount=Decimal('50.00'),
            completed_at=timezone.now(),
        )
        ReturnItem.objects.create(
            return_order=returned,
            sale_item=item,
            quantity=1,
            restock=True,
        )

        data = get_report_data(timezone.localdate(), timezone.localdate())

        self.assertEqual(data['gross_revenue'], 100.0)
        self.assertEqual(data['total_returns'], 50.0)
        self.assertEqual(data['total_revenue'], 50.0)
        self.assertEqual(data['net_cost'], 30.0)
        self.assertEqual(data['gross_margin'], 20.0)


class ReportLogTest(TestCase):
    """Tests pour l'historique des rapports"""

    def test_create_report_log(self):
        """Test création d'un log de rapport"""
        today = timezone.localdate()
        log = ReportLog.objects.create(
            report_type='DAILY',
            period_start=today,
            period_end=today,
            total_sales=10,
            total_revenue=Decimal('500.00'),
            total_profit=Decimal('150.00'),
            items_sold={'items': []},
            recipients='test@email.com',
            success=True
        )
        self.assertEqual(log.report_type, 'DAILY')
        self.assertTrue(log.success)


class ReportingAPITest(APITestCase):
    """Tests API pour les rapports"""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')

    def test_daily_report(self):
        """Test endpoint rapport journalier"""
        response = self.client.get('/api/reporting/daily/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('total_sales', response.data)

    def test_weekly_report(self):
        """Test endpoint rapport hebdomadaire"""
        response = self.client.get('/api/reporting/weekly/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_monthly_report(self):
        """Test endpoint rapport mensuel"""
        response = self.client.get('/api/reporting/monthly/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_stats_endpoint(self):
        """Test endpoint statistiques"""
        response = self.client.get('/api/reporting/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('today', response.data)

    def test_report_settings(self):
        """Test endpoint paramètres rapports"""
        response = self.client.get('/api/reporting/settings/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_update_report_settings(self):
        """Test mise à jour paramètres rapports"""
        data = {
            'daily_enabled': True,
            'weekly_enabled': False,
            'email_recipients': 'test@example.com'
        }
        response = self.client.patch('/api/reporting/settings/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_report_logs(self):
        """Test liste des logs de rapports"""
        response = self.client.get('/api/reporting/logs/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
