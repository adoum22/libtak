import base64
from concurrent.futures import ThreadPoolExecutor
import os
import sqlite3
import tempfile
from contextlib import closing, nullcontext
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from reporting.backup_utils import decrypt_archive, validate_zip_archive

from reporting.tasks import _dump_database_fixture, daily_database_backup


class OffsiteEncryptedBackupTest(TestCase):
    def run_backup(self, root, offsite_dir):
        local_dir = root / 'local'
        media_dir = root / 'media'
        media_dir.mkdir()
        source_db = root / 'source.sqlite3'
        with closing(sqlite3.connect(source_db)) as connection:
            connection.execute('CREATE TABLE django_migrations (id INTEGER)')
            connection.execute('CREATE TABLE core_user (id INTEGER)')
            connection.execute('CREATE TABLE proof (value TEXT)')
            connection.execute("INSERT INTO proof VALUES ('preserved')")
            connection.commit()
        key = base64.urlsafe_b64encode(b'o' * 32).decode('ascii')
        database_settings = {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': source_db,
            },
        }
        environment = {
            'BACKUP_DIR': str(local_dir),
            'BACKUP_OFFSITE_DIR': str(offsite_dir),
            'BACKUP_ENCRYPTION_KEY': key,
            'BACKUP_RETENTION_DAYS': '30',
            'BACKUP_S3_BUCKET': '',
        }
        with override_settings(
            DATABASES=database_settings,
            MEDIA_ROOT=media_dir,
        ), patch.dict(os.environ, environment), patch(
            'reporting.tasks.ReportLog.objects.create'
        ) as report_log:
            result = str(daily_database_backup())
        self.assertTrue(result.startswith('Backup created: '), result)
        return Path(result.split(': ', 1)[1]), report_log

    def test_encrypted_archive_is_copied_to_separate_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            offsite_dir = root / 'offsite'
            local_path, report_log = self.run_backup(root, offsite_dir)

            offsite_path = offsite_dir / local_path.name
            self.assertTrue(local_path.is_file())
            self.assertEqual(local_path.read_bytes()[:5], b'LTBK1')
            self.assertEqual(offsite_path.read_bytes(), local_path.read_bytes())
            self.assertEqual(
                report_log.call_args.kwargs['recipients'],
                'encrypted-local-and-offsite-storage',
            )

    def test_offsite_failure_never_deletes_finalized_local_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unavailable_mount = root / 'not-a-directory'
            unavailable_mount.write_text('blocked', encoding='utf-8')
            with patch('reporting.tasks.logger.warning') as warning:
                local_path, report_log = self.run_backup(root, unavailable_mount)

            self.assertTrue(local_path.is_file())
            self.assertTrue(warning.called)
            self.assertEqual(
                report_log.call_args.kwargs['recipients'],
                'encrypted-local-storage',
            )
            self.assertTrue(report_log.call_args.kwargs['error_message'])


class BackupSourceValidationTest(TestCase):
    def run_invalid_sqlite_backup(self, root, source_db):
        media_dir = root / 'media'
        media_dir.mkdir()
        key = base64.urlsafe_b64encode(b'v' * 32).decode('ascii')
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
            'BACKUP_DIR': str(root / 'backups'),
            'BACKUP_OFFSITE_DIR': '',
            'BACKUP_ENCRYPTION_KEY': key,
            'BACKUP_S3_BUCKET': '',
        }), patch(
            'reporting.tasks.ReportLog.objects.create'
        ) as report_log:
            result = str(daily_database_backup())
        return result, report_log

    def test_missing_sqlite_source_fails_without_creating_empty_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_db = root / 'missing.sqlite3'
            result, report_log = self.run_invalid_sqlite_backup(root, source_db)

            self.assertTrue(result.startswith('Backup failed: '), result)
            self.assertFalse(source_db.exists())
            self.assertFalse(report_log.call_args.kwargs['success'])

    def test_non_libtak_sqlite_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_db = root / 'unrelated.sqlite3'
            with closing(sqlite3.connect(source_db)) as connection:
                connection.execute('CREATE TABLE unrelated (id INTEGER)')
                connection.commit()

            result, report_log = self.run_invalid_sqlite_backup(root, source_db)

            self.assertTrue(result.startswith('Backup failed: '), result)
            self.assertFalse(report_log.call_args.kwargs['success'])


class ConcurrentEncryptedBackupTest(TestCase):
    def test_same_timestamp_backups_use_distinct_atomic_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            media_dir = root / 'media'
            media_dir.mkdir()
            source_db = root / 'source.sqlite3'
            with closing(sqlite3.connect(source_db)) as connection:
                connection.execute('CREATE TABLE django_migrations (id INTEGER)')
                connection.execute('CREATE TABLE core_user (id INTEGER)')
                connection.commit()
            key = base64.urlsafe_b64encode(b'q' * 32).decode('ascii')
            database_settings = {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': source_db,
                },
            }
            fixed_now = timezone.now()

            with override_settings(
                DATABASES=database_settings,
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_OFFSITE_DIR': '',
                'BACKUP_ENCRYPTION_KEY': key,
                'BACKUP_S3_BUCKET': '',
            }), patch(
                'reporting.tasks.timezone.localtime', return_value=fixed_now,
            ), patch('reporting.tasks.ReportLog.objects.create'):
                with ThreadPoolExecutor(max_workers=2) as executor:
                    results = list(executor.map(
                        lambda _index: str(daily_database_backup()),
                        range(2),
                    ))

            self.assertTrue(all(
                result.startswith('Backup created: ') for result in results
            ), results)
            encrypted_paths = {
                Path(result.split(': ', 1)[1]) for result in results
            }
            self.assertEqual(len(encrypted_paths), 2)
            self.assertFalse(any(
                path.name.endswith('.tmp') for path in backup_dir.iterdir()
            ))
            with patch.dict(os.environ, {'BACKUP_ENCRYPTION_KEY': key}):
                for index, encrypted in enumerate(encrypted_paths):
                    decrypted = root / f'concurrent-{index}.zip'
                    decrypt_archive(encrypted, decrypted)
                    validate_zip_archive(decrypted)


class ServerBackupSnapshotTest(SimpleTestCase):
    def test_postgresql_dump_runs_in_read_only_repeatable_read_transaction(self):
        events = []
        cursor = MagicMock()
        cursor.execute.side_effect = lambda _sql: events.append('isolation')
        cursor_context = MagicMock()
        cursor_context.__enter__.return_value = cursor
        database_connection = MagicMock(vendor='postgresql')
        database_connection.cursor.return_value = cursor_context
        connection_registry = MagicMock()
        connection_registry.__getitem__.return_value = database_connection

        def fake_dumpdata(*_args, **kwargs):
            events.append('dumpdata')
            kwargs['stdout'].write('[]')

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'database.json'
            with patch(
                'reporting.tasks.connections', connection_registry,
            ), patch(
                'reporting.tasks.transaction.atomic',
                side_effect=lambda **_kwargs: nullcontext(),
            ) as atomic, patch(
                'django.core.management.call_command',
                side_effect=fake_dumpdata,
            ) as dumpdata:
                _dump_database_fixture(destination)

        self.assertEqual(events, ['isolation', 'dumpdata'])
        atomic.assert_called_once_with(using='default')
        cursor.execute.assert_called_once_with(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
        )
        self.assertEqual(dumpdata.call_args.kwargs['database'], 'default')
