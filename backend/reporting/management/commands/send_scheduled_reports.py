"""
Send all scheduled reports that are due today.

Designed to run ONCE per day (e.g. via PythonAnywhere Scheduled Tasks at 23:00),
as a free replacement for Celery Beat when no Redis broker is available.

Logic mirrors the CELERY_BEAT_SCHEDULE in config/settings.py:
  - daily      : every day
  - weekly     : on Sunday (weekday() == 6)
  - monthly    : on the 28th of every month
  - quarterly  : on the 28th of March / June / September / December
  - yearly     : on December 31st
  - low-stock  : every day (originally scheduled at 09:00, but bundled here for simplicity)
  - db backup  : every day

Usage on PythonAnywhere "Tasks" tab (one daily task at 23:00):

    workon libtak && cd ~/libtak/backend && python manage.py send_scheduled_reports

Optional flags for testing:
    --force-all     run every report regardless of date (manual full run)
    --skip-backup   don't run daily_database_backup
    --dry-run       log what would run without actually running
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
    help = 'Send all reports that are due today (replaces Celery Beat on free hosting tiers).'

    def add_arguments(self, parser):
        parser.add_argument('--force-all', action='store_true',
                            help='Run every report regardless of date.')
        parser.add_argument('--skip-backup', action='store_true',
                            help='Skip daily_database_backup.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Print what would run without executing.')

    def _run(self, label, func, dry_run):
        if dry_run:
            self.stdout.write(f'  [dry-run] would run: {label}')
            return
        try:
            # @shared_task decorated functions are callable synchronously.
            func()
            self.stdout.write(self.style.SUCCESS(f'  ✓ {label}'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ {label} failed: {e}'))

    def handle(self, *args, **opts):
        today = timezone.localdate()
        force = opts['force_all']
        dry = opts['dry_run']
        self.stdout.write(f'send_scheduled_reports — {today.isoformat()} (weekday={today.weekday()}, day={today.day}, month={today.month})')

        # Daily — every day
        self._run('daily report', send_daily_report, dry)

        # Low stock alert — every day (was 09:00 in Celery Beat, OK to bundle here)
        self._run('low stock alert', send_low_stock_alert, dry)

        # Weekly — Sunday
        if force or today.weekday() == 6:
            self._run('weekly report', send_weekly_report, dry)

        # Monthly — 28th
        if force or today.day == 28:
            self._run('monthly report', send_monthly_report, dry)

        # Quarterly — 28 Mar / Jun / Sep / Dec
        if force or (today.day == 28 and today.month in (3, 6, 9, 12)):
            self._run('quarterly report', send_quarterly_report, dry)

        # Yearly — 31 Dec
        if force or (today.day == 31 and today.month == 12):
            self._run('yearly report', send_yearly_report, dry)

        # DB backup — every day, unless skipped
        if not opts['skip_backup']:
            self._run('database backup', daily_database_backup, dry)

        self.stdout.write(self.style.SUCCESS('Done.'))
