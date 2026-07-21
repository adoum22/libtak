"""
Create a local backup and try a cloud push if sync is configured.

Designed for a local/offline-first deployment. Schedule every 30 minutes:

    cd ~/libtak/backend && python manage.py local_backup_sync

The command never fails just because internet/cloud sync is unavailable:
the local backup is created first, then sync is best-effort.
"""
from django.core.management.base import BaseCommand

from reporting.tasks import daily_database_backup


class Command(BaseCommand):
    help = 'Create a local backup and optionally push pending data to cloud.'

    def handle(self, *args, **options):
        backup_result = daily_database_backup()
        self.stdout.write(self.style.SUCCESS(f'backup: {backup_result}'))

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
