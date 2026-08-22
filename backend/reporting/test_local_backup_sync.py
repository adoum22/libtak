from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from reporting.models import ReportLog
from reporting.offsite_s3 import OffsiteS3SyncResult


class LocalBackupSyncCommandTest(TestCase):
    def test_existing_daily_backup_is_not_duplicated(self):
        today = timezone.localdate()
        ReportLog.objects.create(
            report_type=ReportLog.ReportType.BACKUP,
            period_start=today,
            period_end=today,
            total_sales=0,
            total_revenue=0,
            total_profit=0,
            items_sold=[],
            recipients='encrypted-local-storage',
            success=True,
        )

        with patch(
            'reporting.management.commands.local_backup_sync.daily_database_backup',
        ) as backup, patch(
            'reporting.management.commands.local_backup_sync.call_command',
        ) as scheduler, patch(
            'reporting.management.commands.local_backup_sync.'
            'sync_encrypted_backups_to_s3',
            return_value=OffsiteS3SyncResult(
                enabled=True,
                archives=2,
                verified=2,
            ),
        ) as offsite_sync, patch(
            'core.sync_service.sync_service.push_to_cloud',
            return_value={'status': 'success'},
        ):
            call_command('local_backup_sync')

        backup.assert_not_called()
        offsite_sync.assert_called_once()
        scheduler.assert_called_once_with('send_scheduled_reports', '--skip-backup')

    def test_backup_failure_does_not_prevent_scheduler_or_offline_sync_result(self):
        with patch(
            'reporting.management.commands.local_backup_sync.daily_database_backup',
            return_value='Backup failed: missing key',
        ) as backup, patch(
            'reporting.management.commands.local_backup_sync.call_command',
        ) as scheduler, patch(
            'core.sync_service.sync_service.push_to_cloud',
            return_value={'status': 'error', 'code': 'not_configured'},
        ) as sync:
            with self.assertRaises(CommandError):
                call_command('local_backup_sync')

        backup.assert_called_once_with()
        scheduler.assert_called_once_with('send_scheduled_reports', '--skip-backup')
        sync.assert_called_once_with()
