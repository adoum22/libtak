"""
Send all scheduled reports that are due today.

Designed to run once per day via PythonAnywhere Scheduled Tasks at 23:00:

    cd ~/libtak/backend && python manage.py send_scheduled_reports

Optional flags for testing:
    --force-all     run every report regardless of date
    --skip-backup   do not run daily_database_backup
    --dry-run       log what would run without executing
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from reporting.tasks import (
    send_daily_report,
    send_weekly_report,
    send_monthly_report,
    send_quarterly_report,
    send_yearly_report,
    send_low_stock_alert,
    daily_database_backup,
)


class Command(BaseCommand):
    help = 'Send all reports that are due today.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force-all',
            action='store_true',
            help='Run every report regardless of date.',
        )
        parser.add_argument(
            '--skip-backup',
            action='store_true',
            help='Skip daily_database_backup.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would run without executing.',
        )

    def _run(self, label, func, dry_run):
        if dry_run:
            self.stdout.write(f'  [dry-run] would run: {label}')
            return

        try:
            # @shared_task decorated functions are callable synchronously.
            result = func()
            result_text = str(result)
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'  X {label} failed: {exc}'))
            return

        failed_markers = (
            'sent: False',
            'No recipients configured',
            'Error sending',
            'failed',
            'Backup failed',
        )
        if any(marker in result_text for marker in failed_markers):
            self.stdout.write(self.style.ERROR(f'  X {label}: {result_text}'))
        else:
            self.stdout.write(self.style.SUCCESS(f'  OK {label}: {result_text}'))

    def handle(self, *args, **opts):
        today = timezone.localdate()
        force = opts['force_all']
        dry = opts['dry_run']
        self.stdout.write(
            f'send_scheduled_reports - {today.isoformat()} '
            f'(weekday={today.weekday()}, day={today.day}, month={today.month})'
        )

        self._run('daily report', send_daily_report, dry)
        self._run('low stock alert', send_low_stock_alert, dry)

        if force or today.weekday() == 6:
            self._run('weekly report', send_weekly_report, dry)

        if force or today.day == 28:
            self._run('monthly report', send_monthly_report, dry)

        if force or (today.day == 28 and today.month in (3, 6, 9, 12)):
            self._run('quarterly report', send_quarterly_report, dry)

        if force or (today.day == 31 and today.month == 12):
            self._run('yearly report', send_yearly_report, dry)

        if not opts['skip_backup']:
            self._run('database backup', daily_database_backup, dry)

        self.stdout.write(self.style.SUCCESS('Done.'))
