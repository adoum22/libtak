from django.core.management.base import BaseCommand, CommandError

from reporting.offsite_s3 import (
    safe_s3_error,
    secure_backup_directory,
    sync_encrypted_backups_to_s3,
)


class Command(BaseCommand):
    help = 'Upload and verify pending encrypted backups on S3-compatible storage.'

    def handle(self, *args, **options):
        try:
            result = sync_encrypted_backups_to_s3(secure_backup_directory())
        except Exception as exc:
            raise CommandError(
                f'Off-site S3 synchronization failed ({safe_s3_error(exc)}).'
            ) from None

        if not result.enabled:
            self.stdout.write(self.style.WARNING(
                'offsite-s3: disabled (BACKUP_S3_BUCKET is empty)'
            ))
            return

        summary = (
            f'offsite-s3: {result.verified}/{result.archives} verified, '
            f'{result.uploaded} uploaded, {len(result.pending)} pending '
            f'({result.pending_bytes} bytes)'
        )
        if result.errors:
            self.stderr.write(self.style.ERROR(summary))
            raise CommandError(
                'Off-site S3 synchronization incomplete: '
                + ', '.join(result.errors)
            )
        self.stdout.write(self.style.SUCCESS(summary))
