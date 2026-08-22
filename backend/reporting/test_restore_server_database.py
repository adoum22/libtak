import json
import sqlite3
import tempfile
import zipfile
from contextlib import closing, nullcontext
from pathlib import Path
from unittest.mock import patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from reporting.management.commands.restore_backup import Command


SERVER_DATABASE = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'libtak',
    },
}


class ServerDatabaseRestoreTest(SimpleTestCase):
    def make_decrypted_archive(self, directory, fixture):
        archive = Path(directory) / 'decrypted.zip'
        with zipfile.ZipFile(archive, 'w') as stream:
            stream.writestr('database.json', json.dumps(fixture))
        return archive

    @override_settings(DATABASES=SERVER_DATABASE)
    def test_postgresql_json_restore_is_validated_and_transactional(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup.ltbk'
            backup.write_bytes(b'encrypted-placeholder')
            decrypted_source = self.make_decrypted_archive(directory, [{
                'model': 'core.user',
                'pk': 1,
                'fields': {'username': 'restored-admin'},
            }])

            def decrypt(_source, destination):
                destination.write_bytes(decrypted_source.read_bytes())

            with patch(
                'reporting.management.commands.restore_backup.daily_database_backup',
                return_value='Backup created: safety.ltbk',
            ), patch(
                'reporting.management.commands.restore_backup.decrypt_archive',
                side_effect=decrypt,
            ), patch(
                'reporting.management.commands.restore_backup.validate_zip_archive',
                return_value={'database_engine': 'django.db.backends.postgresql'},
            ), patch(
                'reporting.management.commands.restore_backup.transaction.atomic',
                side_effect=lambda **_kwargs: nullcontext(),
            ), patch(
                'reporting.management.commands.restore_backup.call_command',
            ) as call:
                Command().handle(
                    backup_file=str(backup),
                    confirm='RESTORE',
                    include_media=False,
                )

            self.assertEqual(call.call_args_list[0].args[0], 'flush')
            self.assertEqual(call.call_args_list[1].args[0], 'loaddata')

    @override_settings(DATABASES=SERVER_DATABASE)
    def test_non_libtak_json_is_rejected_before_flush(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup.ltbk'
            backup.write_bytes(b'encrypted-placeholder')
            decrypted_source = self.make_decrypted_archive(directory, [{
                'model': 'unrelated.row',
                'pk': 1,
                'fields': {},
            }])

            def decrypt(_source, destination):
                destination.write_bytes(decrypted_source.read_bytes())

            with patch(
                'reporting.management.commands.restore_backup.daily_database_backup',
                return_value='Backup created: safety.ltbk',
            ), patch(
                'reporting.management.commands.restore_backup.decrypt_archive',
                side_effect=decrypt,
            ), patch(
                'reporting.management.commands.restore_backup.validate_zip_archive',
                return_value={'database_engine': 'django.db.backends.postgresql'},
            ), patch(
                'reporting.management.commands.restore_backup.call_command',
            ) as call:
                with self.assertRaises(CommandError):
                    Command().handle(
                        backup_file=str(backup),
                        confirm='RESTORE',
                        include_media=False,
                    )

            call.assert_not_called()


class SQLiteDatabaseRestoreTest(SimpleTestCase):
    def test_sqlite_candidate_handle_is_closed_before_temporary_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current_database = root / 'current.sqlite3'
            archived_database = root / 'archived.sqlite3'
            backup = root / 'backup.ltbk'
            decrypted_source = root / 'decrypted.zip'
            backup.write_bytes(b'encrypted-placeholder')

            with closing(sqlite3.connect(current_database)) as database:
                database.execute('CREATE TABLE original_marker (value TEXT)')
                database.execute("INSERT INTO original_marker VALUES ('before')")
                database.commit()

            with closing(sqlite3.connect(archived_database)) as database:
                database.execute('CREATE TABLE django_migrations (id INTEGER)')
                database.execute('CREATE TABLE core_user (id INTEGER)')
                database.execute('CREATE TABLE restore_marker (value TEXT)')
                database.execute("INSERT INTO restore_marker VALUES ('restored')")
                database.commit()

            with zipfile.ZipFile(decrypted_source, 'w') as archive:
                archive.write(archived_database, 'database.sqlite3')

            def decrypt(_source, destination):
                destination.write_bytes(decrypted_source.read_bytes())

            sqlite_settings = {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': str(current_database),
                },
            }
            with override_settings(DATABASES=sqlite_settings), patch(
                'reporting.management.commands.restore_backup.daily_database_backup',
                return_value='Backup created: safety.ltbk',
            ), patch(
                'reporting.management.commands.restore_backup.decrypt_archive',
                side_effect=decrypt,
            ), patch(
                'reporting.management.commands.restore_backup.validate_zip_archive',
                return_value={'database_engine': 'django.db.backends.sqlite3'},
            ), patch(
                'reporting.management.commands.restore_backup.connections.all',
                return_value=[],
            ):
                Command().handle(
                    backup_file=str(backup),
                    confirm='RESTORE',
                    include_media=False,
                )

            with closing(sqlite3.connect(current_database)) as restored:
                value = restored.execute(
                    'SELECT value FROM restore_marker',
                ).fetchone()[0]
            self.assertEqual(value, 'restored')

    def test_locked_sqlite_restore_removes_plaintext_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current_database = root / 'current.sqlite3'
            archived_database = root / 'archived.sqlite3'
            backup = root / 'backup.ltbk'
            decrypted_source = root / 'decrypted.zip'
            backup.write_bytes(b'encrypted-placeholder')

            with closing(sqlite3.connect(current_database)) as database:
                database.execute('CREATE TABLE current_marker (value TEXT)')
                database.commit()
            with closing(sqlite3.connect(archived_database)) as database:
                database.execute('CREATE TABLE django_migrations (id INTEGER)')
                database.execute('CREATE TABLE core_user (id INTEGER)')
                database.commit()
            with zipfile.ZipFile(decrypted_source, 'w') as archive:
                archive.write(archived_database, 'database.sqlite3')

            def decrypt(_source, destination):
                destination.write_bytes(decrypted_source.read_bytes())

            sqlite_settings = {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': str(current_database),
                },
            }
            with override_settings(DATABASES=sqlite_settings), patch(
                'reporting.management.commands.restore_backup.daily_database_backup',
                return_value='Backup created: safety.ltbk',
            ), patch(
                'reporting.management.commands.restore_backup.decrypt_archive',
                side_effect=decrypt,
            ), patch(
                'reporting.management.commands.restore_backup.validate_zip_archive',
                return_value={'database_engine': 'django.db.backends.sqlite3'},
            ), patch(
                'reporting.management.commands.restore_backup.connections.all',
                return_value=[],
            ), patch(
                'reporting.management.commands.restore_backup.os.replace',
                side_effect=PermissionError('database locked'),
            ):
                with self.assertRaises(CommandError) as error:
                    Command().handle(
                        backup_file=str(backup),
                        confirm='RESTORE',
                        include_media=False,
                    )

            self.assertIn('Stop the backend', str(error.exception))
            self.assertEqual(list(root.glob('.*.restore.tmp')), [])
