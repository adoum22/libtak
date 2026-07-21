import os
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from reporting.backup_utils import (
    BackupValidationError,
    decrypt_archive,
    validate_zip_archive,
)
from reporting.tasks import daily_database_backup


class Command(BaseCommand):
    help = 'Restore a verified encrypted SQLite backup (explicit confirmation required).'

    def add_arguments(self, parser):
        parser.add_argument('backup_file')
        parser.add_argument(
            '--confirm',
            help='Pass exactly RESTORE to authorize replacing the current database.',
        )
        parser.add_argument(
            '--include-media',
            action='store_true',
            help='Restore archived media files, overwriting files with the same names.',
        )

    def handle(self, *args, **options):
        if options.get('confirm') != 'RESTORE':
            raise CommandError('Restore refused. Re-run with --confirm RESTORE.')
        engine = settings.DATABASES['default']['ENGINE']
        if not engine.endswith('sqlite3'):
            raise CommandError(
                'Automated restore is limited to SQLite. Use your database '
                'provider restore procedure for PostgreSQL.',
            )
        backup_path = Path(options['backup_file']).expanduser().resolve()
        if not backup_path.is_file() or backup_path.suffix != '.ltbk':
            raise CommandError('Select an existing .ltbk backup file.')

        current_backup = str(daily_database_backup())
        if current_backup.startswith('Backup failed:'):
            raise CommandError(
                'Safety backup of the current state failed; restore aborted. '
                + current_backup,
            )

        try:
            with tempfile.TemporaryDirectory(prefix='libtak-restore-') as temp_name:
                temp_dir = Path(temp_name)
                decrypted = temp_dir / 'backup.zip'
                decrypt_archive(backup_path, decrypted)
                manifest = validate_zip_archive(decrypted)
                if not str(manifest.get('database_engine', '')).endswith('sqlite3'):
                    raise BackupValidationError('The archive is not a SQLite backup.')

                extracted_db = temp_dir / 'database.sqlite3'
                with zipfile.ZipFile(decrypted, 'r') as archive:
                    with archive.open('database.sqlite3', 'r') as source, extracted_db.open('wb') as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)

                    if options['include_media']:
                        staged_media = (temp_dir / 'media').resolve()
                        staged_media.mkdir(parents=True, exist_ok=True)
                        for member in archive.infolist():
                            path = PurePosixPath(member.filename)
                            if len(path.parts) < 2 or path.parts[0] != 'media' or member.is_dir():
                                continue
                            relative = Path(*path.parts[1:])
                            destination = (staged_media / relative).resolve()
                            if staged_media not in destination.parents:
                                raise BackupValidationError('Unsafe media path in backup.')
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            with archive.open(member, 'r') as source, destination.open('wb') as target:
                                shutil.copyfileobj(source, target, length=1024 * 1024)

                with sqlite3.connect(
                    f'file:{extracted_db.as_posix()}?mode=ro', uri=True,
                ) as candidate:
                    integrity = candidate.execute('PRAGMA integrity_check').fetchone()
                    if not integrity or integrity[0] != 'ok':
                        raise BackupValidationError(
                            'SQLite integrity check failed for the backup.',
                        )
                    required_tables = {'django_migrations', 'core_user'}
                    present_tables = {
                        row[0]
                        for row in candidate.execute(
                            "SELECT name FROM sqlite_master WHERE type='table'"
                        )
                    }
                    if not required_tables.issubset(present_tables):
                        raise BackupValidationError(
                            'The SQLite file is not a LibTak database.',
                        )

                database_path = Path(settings.DATABASES['default']['NAME']).resolve()
                if not database_path.is_file():
                    raise BackupValidationError('Current SQLite database path is invalid.')
                replacement = database_path.with_suffix(database_path.suffix + '.restore.tmp')
                shutil.copy2(extracted_db, replacement)
                for connection in connections.all():
                    connection.close()
                os.replace(replacement, database_path)
                try:
                    os.chmod(database_path, 0o600)
                except OSError:
                    pass
                if options['include_media']:
                    media_root = Path(settings.MEDIA_ROOT).resolve()
                    media_root.mkdir(parents=True, exist_ok=True)
                    for staged_file in staged_media.rglob('*'):
                        if not staged_file.is_file():
                            continue
                        relative = staged_file.relative_to(staged_media)
                        destination = (media_root / relative).resolve()
                        if media_root not in destination.parents:
                            raise BackupValidationError('Unsafe media restore path.')
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(staged_file, destination)
        except (
            BackupValidationError,
            KeyError,
            OSError,
            sqlite3.DatabaseError,
            zipfile.BadZipFile,
        ) as exc:
            raise CommandError(f'Restore failed: {exc}') from exc

        self.stdout.write(self.style.SUCCESS(
            f'Restore completed. Safety snapshot: {current_backup}',
        ))
