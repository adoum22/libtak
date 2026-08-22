"""
Create a local backup and try a cloud push if sync is configured.

Designed for a local/offline-first deployment. Schedule every 30 minutes:

    cd ~/libtak/backend && python manage.py local_backup_sync

The command never fails just because internet/cloud sync is unavailable:
the local backup is created first, then sync is best-effort.
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from reporting.models import ReportLog
from reporting.offsite_s3 import (
    safe_s3_error,
    secure_backup_directory,
    sync_encrypted_backups_to_s3,
)
from reporting.tasks import daily_database_backup


class Command(BaseCommand):
    help = 'Create a local backup and optionally push pending data to cloud.'

    def handle(self, *args, **options):
        failures = []
        already_backed_up = ReportLog.objects.filter(
            report_type=ReportLog.ReportType.BACKUP,
            period_start=timezone.localdate(),
            success=True,
        ).exists()
        if already_backed_up:
            self.stdout.write('backup: already completed today')
            try:
                s3_result = sync_encrypted_backups_to_s3(
                    secure_backup_directory()
                )
                if s3_result.enabled:
                    message = (
                        f'offsite-s3: {s3_result.verified}/'
                        f'{s3_result.archives} verified, '
                        f'{len(s3_result.pending)} pending '
                        f'({s3_result.pending_bytes} bytes)'
                    )
                    writer = (
                        self.style.WARNING if s3_result.errors
                        else self.style.SUCCESS
                    )
                    self.stdout.write(writer(message))
            except Exception as exc:
                self.stdout.write(self.style.WARNING(
                    'offsite-s3: retry deferred '
                    f'({safe_s3_error(exc)})'
                ))
        else:
            backup_result = str(daily_database_backup())
            writer = (
                self.style.ERROR
                if backup_result.startswith('Backup failed:')
                else self.style.SUCCESS
            )
            self.stdout.write(writer(f'backup: {backup_result}'))
            if backup_result.startswith('Backup failed:'):
                failures.append('local encrypted backup')

        # Use the same database-driven report scheduler as Celery/cron. Its
        # durable claims make this safe when invoked every 30 minutes.
        try:
            call_command('send_scheduled_reports', '--skip-backup')
        except CommandError as exc:
            self.stderr.write(self.style.ERROR(f'scheduler: {exc}'))
            failures.append('scheduled reports')

        try:
            from core.sync_service import sync_service
            sync_result = sync_service.push_to_cloud()
        except Exception as exc:
            sync_result = {'status': 'error', 'message': str(exc)}

        status = sync_result.get('status')
        if status == 'success':
            self.stdout.write(self.style.SUCCESS(f'sync: {sync_result}'))
        elif sync_result.get('code') == 'not_configured':
            self.stdout.write(self.style.WARNING('sync: non configure, backup local uniquement'))
        else:
            self.stdout.write(self.style.WARNING(f'sync: {sync_result}'))

        if failures:
            raise CommandError(
                'Local maintenance failed: ' + ', '.join(failures)
            )
