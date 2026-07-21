import tempfile
import zipfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from reporting.backup_utils import (
    BackupValidationError,
    decrypt_archive,
    validate_zip_archive,
)


class Command(BaseCommand):
    help = 'Decrypt and verify every checksum in a .ltbk backup.'

    def add_arguments(self, parser):
        parser.add_argument('backup_file')

    def handle(self, *args, **options):
        backup_path = Path(options['backup_file']).expanduser().resolve()
        if not backup_path.is_file() or backup_path.suffix != '.ltbk':
            raise CommandError('Select an existing .ltbk backup file.')
        try:
            with tempfile.TemporaryDirectory(prefix='libtak-verify-') as temp_name:
                decrypted = Path(temp_name) / 'backup.zip'
                decrypt_archive(backup_path, decrypted)
                manifest = validate_zip_archive(decrypted)
        except (BackupValidationError, OSError, zipfile.BadZipFile) as exc:
            raise CommandError(f'Backup verification failed: {exc}') from exc
        self.stdout.write(self.style.SUCCESS(
            'Backup verified successfully: '
            f"{manifest.get('created_at')} ({len(manifest['files_sha256'])} files)",
        ))
