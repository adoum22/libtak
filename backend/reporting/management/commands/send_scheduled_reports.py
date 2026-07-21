"""Send reports that are due according to ReportSettings.

Run this command every 10 to 15 minutes. Database markers make execution
idempotent, so restarts or overlapping scheduler invocations do not duplicate
successful sends. On hosts limited to one invocation per day, use
``--daily-slot`` so configured dates are respected without requiring the
scheduler to run at every configured report time.
"""
from calendar import monthrange
from datetime import time, timedelta
from uuid import uuid4

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from reporting.models import ReportSettings, ScheduledJobClaim
from reporting.tasks import (
    daily_database_backup,
    send_daily_report,
    send_low_stock_alert,
    send_monthly_report,
    send_quarterly_report,
    send_weekly_report,
    send_yearly_report,
)


class Command(BaseCommand):
    help = 'Send enabled reports that are due now, without duplicate sends.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force-all',
            action='store_true',
            help='Run every enabled report regardless of date and time.',
        )
        parser.add_argument(
            '--skip-backup',
            action='store_true',
            help='Skip the daily backup.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what is due without sending or updating markers.',
        )
        parser.add_argument(
            '--daily-slot',
            action='store_true',
            help=(
                'For once-daily schedulers: ignore configured clock times '
                'while preserving enabled flags and report dates.'
            ),
        )

    def _run(self, label, func, dry_run):
        if dry_run:
            self.stdout.write(f'  [dry-run] due: {label}')
            return False
        try:
            result_text = str(func())
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'  X {label} failed: {exc}'))
            return False

        lowered = result_text.lower()
        failed_markers = (
            'sent: false',
            'no recipients configured',
            'error sending',
            'failed',
            'backup failed',
            'disabled',
        )
        if any(marker in lowered for marker in failed_markers):
            self.stdout.write(self.style.ERROR(f'  X {label}: {result_text}'))
            return False
        self.stdout.write(self.style.SUCCESS(f'  OK {label}: {result_text}'))
        return True

    @staticmethod
    def _at_or_after(now_time, configured_time):
        return now_time.replace(tzinfo=None) >= configured_time

    def _is_due(self, marker, today, eligible):
        report_settings = ReportSettings.get_settings()
        return (
            getattr(report_settings, marker) != today
            and eligible(report_settings)
        )

    def _claim(self, job_name, marker, today, eligible):
        """Claim a short lease without keeping a DB transaction during I/O."""
        ReportSettings.get_settings()
        now = timezone.now()
        token = uuid4()
        with transaction.atomic():
            report_settings = ReportSettings.objects.select_for_update().get(pk=1)
            if getattr(report_settings, marker) == today or not eligible(report_settings):
                return None
            claim, created = (
                ScheduledJobClaim.objects.select_for_update().get_or_create(
                    job_name=job_name,
                    run_date=today,
                    defaults={
                        'status': ScheduledJobClaim.Status.RUNNING,
                        'claim_token': token,
                        'claimed_at': now,
                        'lease_expires_at': now + timedelta(minutes=30),
                    },
                )
            )
            if not created:
                if claim.status == ScheduledJobClaim.Status.SUCCESS:
                    return None
                if (
                    claim.status == ScheduledJobClaim.Status.RUNNING
                    and claim.lease_expires_at > now
                ):
                    return None
                claim.status = ScheduledJobClaim.Status.RUNNING
                claim.claim_token = token
                claim.claimed_at = now
                claim.lease_expires_at = now + timedelta(minutes=30)
                claim.completed_at = None
                claim.result_message = ''
                claim.save(update_fields=[
                    'status', 'claim_token', 'claimed_at', 'lease_expires_at',
                    'completed_at', 'result_message',
                ])
        return token

    def _complete(self, job_name, marker, today, token, succeeded):
        now = timezone.now()
        with transaction.atomic():
            report_settings = ReportSettings.objects.select_for_update().get(pk=1)
            claim = ScheduledJobClaim.objects.select_for_update().filter(
                job_name=job_name,
                run_date=today,
                claim_token=token,
            ).first()
            if not claim:
                return
            claim.status = (
                ScheduledJobClaim.Status.SUCCESS
                if succeeded else ScheduledJobClaim.Status.FAILED
            )
            claim.completed_at = now
            claim.result_message = 'completed' if succeeded else 'failed; retry allowed'
            claim.save(update_fields=['status', 'completed_at', 'result_message'])
            if succeeded:
                setattr(report_settings, marker, today)
                report_settings.save(update_fields=[marker, 'updated_at'])

    def _attempt(self, label, func, job_name, marker, today, eligible, dry_run):
        if dry_run:
            if self._is_due(marker, today, eligible):
                self._run(label, func, True)
            return
        token = self._claim(job_name, marker, today, eligible)
        if not token:
            return
        succeeded = self._run(label, func, False)
        self._complete(job_name, marker, today, token, succeeded)

    def handle(self, *args, **opts):
        local_now = timezone.localtime()
        today = local_now.date()
        now_time = local_now.time()
        force = opts['force_all']
        daily_slot = opts['daily_slot']
        dry_run = opts['dry_run']

        def time_is_due(configured_time):
            return force or daily_slot or self._at_or_after(now_time, configured_time)

        self.stdout.write(
            f'send_scheduled_reports - {local_now.isoformat(timespec="minutes")}'
        )

        last_day = today.day == monthrange(today.year, today.month)[1]
        quarter_end = last_day and today.month in (3, 6, 9, 12)
        year_end = today.month == 12 and today.day == 31

        jobs = [
            (
                'daily report', send_daily_report, 'DAILY',
                'daily_last_sent_on',
                lambda settings: settings.daily_enabled
                and time_is_due(settings.daily_time),
            ),
            (
                'weekly report', send_weekly_report, 'WEEKLY',
                'weekly_last_sent_on',
                lambda settings: settings.weekly_enabled and (
                    force or (
                        today.weekday() == settings.weekly_day
                        and time_is_due(settings.weekly_time)
                    )
                ),
            ),
            (
                'monthly report', send_monthly_report, 'MONTHLY',
                'monthly_last_sent_on',
                lambda settings: settings.monthly_enabled and (
                    force or (
                        last_day and time_is_due(settings.monthly_time)
                    )
                ),
            ),
            (
                'quarterly report', send_quarterly_report, 'QUARTERLY',
                'quarterly_last_sent_on',
                lambda settings: settings.quarterly_enabled and (
                    force or (
                        quarter_end
                        and time_is_due(settings.quarterly_time)
                    )
                ),
            ),
            (
                'yearly report', send_yearly_report, 'YEARLY',
                'yearly_last_sent_on',
                lambda settings: settings.yearly_enabled and (
                    force or (
                        year_end and time_is_due(settings.yearly_time)
                    )
                ),
            ),
        ]
        for label, func, job_name, marker, eligible in jobs:
            self._attempt(
                label, func, job_name, marker, today, eligible, dry_run,
            )

        self._attempt(
            'low stock alert', send_low_stock_alert, 'LOW_STOCK',
            'low_stock_last_sent_on', today,
            lambda settings: time_is_due(time(9, 0)),
            dry_run,
        )

        if not opts['skip_backup']:
            self._attempt(
                'database backup', daily_database_backup, 'BACKUP',
                'backup_last_sent_on', today, lambda settings: True, dry_run,
            )

        self.stdout.write(self.style.SUCCESS('Done.'))
