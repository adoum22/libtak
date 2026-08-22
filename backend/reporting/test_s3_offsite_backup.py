import base64
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import traceback
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings

from reporting.backup_utils import BackupValidationError
from reporting.offsite_s3 import (
    OffsiteS3ConfigurationError,
    OffsiteS3SyncResult,
    load_s3_config,
    sync_encrypted_backups_to_s3,
)
from reporting.tasks import daily_database_backup


S3_ENVIRONMENT = {
    'BACKUP_S3_BUCKET': 'libtak-test-backups',
    'BACKUP_S3_PREFIX': 'tenant/backups',
    'BACKUP_S3_ENDPOINT_URL': 'https://s3.example.invalid',
    'BACKUP_S3_REGION': 'test-1',
    'BACKUP_S3_ACCESS_KEY_ID': 'access-key-canary',
    'BACKUP_S3_SECRET_ACCESS_KEY': 'secret-key-canary',
    'AWS_EC2_METADATA_DISABLED': 'true',
}


class MissingObjectError(Exception):
    response = {
        'Error': {'Code': '404'},
        'ResponseMetadata': {'HTTPStatusCode': 404},
    }


class AccessDeniedError(Exception):
    response = {
        'Error': {'Code': 'AccessDenied'},
        'ResponseMetadata': {'HTTPStatusCode': 403},
    }


class FakeS3Client:
    def __init__(self, objects=None):
        self.objects = objects or {}
        self.uploads = []
        self.head_calls = []
        self.get_calls = []

    @staticmethod
    def _identity(stored):
        body_digest = hashlib.sha256(stored['body']).hexdigest()[:16]
        return {
            'ETag': stored.get('etag', f'"etag-{body_digest}"'),
            'VersionId': stored.get('version_id', f'version-{body_digest}'),
        }

    def head_object(self, *, Bucket, Key):
        self.head_calls.append((Bucket, Key))
        try:
            stored = self.objects[(Bucket, Key)]
        except KeyError as exc:
            raise MissingObjectError() from exc
        return {
            'ContentLength': len(stored['body']),
            'Metadata': stored['metadata'],
            **self._identity(stored),
        }

    def upload_file(self, filename, bucket, key, *, ExtraArgs):
        body = Path(filename).read_bytes()
        self.uploads.append((bucket, key, ExtraArgs))
        self.objects[(bucket, key)] = {
            'body': body,
            'metadata': dict(ExtraArgs['Metadata']),
        }

    def get_object(self, *, Bucket, Key, **_conditions):
        self.get_calls.append((Bucket, Key))
        stored = self.objects[(Bucket, Key)]
        return {
            'Body': io.BytesIO(stored['body']),
            **self._identity(stored),
        }


class FailingUploadClient(FakeS3Client):
    def upload_file(self, filename, bucket, key, *, ExtraArgs):
        raise RuntimeError(
            'upload failed with access-key-canary and secret-key-canary'
        )


class FailingGlobalHeadClient(FakeS3Client):
    def head_object(self, *, Bucket, Key):
        self.head_calls.append((Bucket, Key))
        raise AccessDeniedError('secret-key-canary')


class S3OffsiteTransportTest(SimpleTestCase):
    def test_disabled_transport_does_not_create_a_client(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {'BACKUP_S3_BUCKET': ''},
            clear=True,
        ), patch('reporting.offsite_s3._build_s3_client') as builder:
            result = sync_encrypted_backups_to_s3(Path(directory))

        self.assertFalse(result.enabled)
        builder.assert_not_called()

    def test_partial_credentials_are_rejected_without_echoing_values(self):
        invalid_sets = (
            {'BACKUP_S3_ACCESS_KEY_ID': 'access-key-canary'},
            {'BACKUP_S3_SECRET_ACCESS_KEY': 'secret-key-canary'},
            {'BACKUP_S3_SESSION_TOKEN': 'session-token-canary'},
            {
                'BACKUP_S3_ACCESS_KEY_ID': 'access-key-canary',
                'BACKUP_S3_SESSION_TOKEN': 'session-token-canary',
            },
        )
        for invalid in invalid_sets:
            environment = {
                'BACKUP_S3_BUCKET': 'bucket',
                'BACKUP_S3_PREFIX': 'backups',
                **invalid,
            }
            with self.subTest(invalid=tuple(invalid)), tempfile.TemporaryDirectory() as directory, patch.dict(
                os.environ,
                environment,
                clear=True,
            ), patch('reporting.offsite_s3._build_s3_client') as builder:
                with self.assertRaises(OffsiteS3ConfigurationError) as raised:
                    sync_encrypted_backups_to_s3(Path(directory))

            message = str(raised.exception)
            self.assertNotIn('access-key-canary', message)
            self.assertNotIn('secret-key-canary', message)
            self.assertNotIn('session-token-canary', message)
            builder.assert_not_called()

    def test_bucket_name_with_slash_is_rejected(self):
        environment = {
            **S3_ENVIRONMENT,
            'BACKUP_S3_BUCKET': 'invalid/bucket-name',
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaises(OffsiteS3ConfigurationError):
                load_s3_config()

    def test_upload_rechecks_encrypted_bytes_and_reuses_atomic_marker(self):
        payload = b'LTBK1' + b'encrypted-payload' * 10
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_2026-01-01.ltbk'
            archive.write_bytes(payload)
            client = FakeS3Client()
            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                first = sync_encrypted_backups_to_s3(root, client=client)
                second = sync_encrypted_backups_to_s3(root, client=client)

            self.assertEqual(first.uploaded, 1)
            self.assertEqual(first.verified, 1)
            self.assertEqual(first.confirmed, frozenset({archive}))
            self.assertEqual(first.pending, ())
            self.assertEqual(len(client.uploads), 1)
            metadata = client.uploads[0][2]['Metadata']
            self.assertEqual(metadata['format'], 'ltbk1')
            self.assertEqual(metadata['sha256'], hashlib.sha256(payload).hexdigest())
            self.assertEqual(len(client.get_calls), 1)
            self.assertEqual(second.uploaded, 0)
            self.assertEqual(second.verified, 1)
            self.assertEqual(len(client.get_calls), 1)
            self.assertEqual(
                len(list(root.glob('.*.s3-ok.json'))),
                1,
            )

    def test_corrupt_json_marker_is_reverified_and_replaced(self):
        payload = b'LTBK1' + b'encrypted-payload'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_corrupt_marker.ltbk'
            archive.write_bytes(payload)
            marker = root / f'.{archive.name}.s3-ok.json'
            marker.write_text('{not-valid-json', encoding='utf-8')
            key = 'tenant/backups/' + archive.name
            client = FakeS3Client({
                ('libtak-test-backups', key): {
                    'body': payload,
                    'metadata': {
                        'sha256': hashlib.sha256(payload).hexdigest(),
                        'format': 'ltbk1',
                    },
                },
            })

            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                result = sync_encrypted_backups_to_s3(root, client=client)

            self.assertEqual(result.confirmed, frozenset({archive}))
            self.assertEqual(result.pending, ())
            self.assertEqual(result.uploaded, 0)
            self.assertEqual(client.get_calls, [
                ('libtak-test-backups', key),
            ])
            recovered_marker = json.loads(marker.read_text(encoding='utf-8'))
            self.assertEqual(recovered_marker['bucket'], 'libtak-test-backups')
            self.assertEqual(recovered_marker['key'], key)
            self.assertEqual(
                recovered_marker['sha256'],
                hashlib.sha256(payload).hexdigest(),
            )
            self.assertTrue(recovered_marker['remote_identity']['etag'])
            self.assertTrue(recovered_marker['remote_identity']['version_id'])
            self.assertEqual(list(root.glob('*.tmp')), [])

    def test_archive_without_ltbk1_header_is_rejected_before_network_access(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_plaintext.ltbk'
            archive.write_bytes(b'not-an-encrypted-libtak-backup')
            client = FakeS3Client()

            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                result = sync_encrypted_backups_to_s3(root, client=client)

            self.assertEqual(result.confirmed, frozenset())
            self.assertEqual(result.pending, (archive,))
            self.assertTrue(result.errors)
            self.assertEqual(client.head_calls, [])
            self.assertEqual(client.uploads, [])
            self.assertEqual(client.get_calls, [])
            self.assertEqual(list(root.glob('.*.s3-ok.json')), [])

    def test_failed_archive_is_pending_and_retried_on_next_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_pending.ltbk'
            archive.write_bytes(b'LTBK1pending')
            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                failed = sync_encrypted_backups_to_s3(
                    root,
                    client=FailingUploadClient(),
                )
                recovered = sync_encrypted_backups_to_s3(
                    root,
                    client=FakeS3Client(),
                )

            self.assertEqual(failed.confirmed, frozenset())
            self.assertEqual(failed.pending, (archive,))
            self.assertTrue(failed.errors)
            self.assertNotIn('access-key-canary', ' '.join(failed.errors))
            self.assertNotIn('secret-key-canary', ' '.join(failed.errors))
            self.assertEqual(recovered.confirmed, frozenset({archive}))
            self.assertTrue(archive.exists())

    def test_global_head_failure_stops_circuit_and_preserves_valid_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / 'libtak_backup_a.ltbk'
            second = root / 'libtak_backup_b.ltbk'
            first.write_bytes(b'LTBK1first')
            second.write_bytes(b'LTBK1second')
            seeded_client = FakeS3Client()

            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                seeded = sync_encrypted_backups_to_s3(
                    root,
                    client=seeded_client,
                )
                first_marker = root / f'.{first.name}.s3-ok.json'
                second_marker = root / f'.{second.name}.s3-ok.json'
                marker_contents = {
                    first_marker: first_marker.read_bytes(),
                    second_marker: second_marker.read_bytes(),
                }
                failing_client = FailingGlobalHeadClient()
                failed = sync_encrypted_backups_to_s3(
                    root,
                    client=failing_client,
                )

            self.assertEqual(seeded.confirmed, frozenset({first, second}))
            self.assertEqual(failed.confirmed, frozenset())
            self.assertEqual(failed.pending, (first, second))
            self.assertEqual(len(failed.errors), 1)
            self.assertNotIn('secret-key-canary', failed.errors[0])
            self.assertEqual(failing_client.head_calls, [
                ('libtak-test-backups', 'tenant/backups/' + first.name),
            ])
            self.assertEqual(failing_client.uploads, [])
            self.assertEqual(failing_client.get_calls, [])
            for marker, contents in marker_contents.items():
                self.assertEqual(marker.read_bytes(), contents)

    def test_existing_remote_mismatch_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_collision.ltbk'
            archive.write_bytes(b'LTBK1expected')
            key = 'tenant/backups/' + archive.name
            client = FakeS3Client({
                ('libtak-test-backups', key): {
                    'body': b'LTBK1different',
                    'metadata': {'sha256': 'wrong', 'format': 'ltbk1'},
                },
            })
            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                result = sync_encrypted_backups_to_s3(root, client=client)

            self.assertEqual(result.pending, (archive,))
            self.assertTrue(result.errors)
            self.assertEqual(client.uploads, [])
            self.assertEqual(
                client.objects[('libtak-test-backups', key)]['body'],
                b'LTBK1different',
            )

    def test_matching_metadata_without_matching_body_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_corrupt.ltbk'
            payload = b'LTBK1expected'
            archive.write_bytes(payload)
            key = 'tenant/backups/' + archive.name
            client = FakeS3Client({
                ('libtak-test-backups', key): {
                    'body': b'LTBK1corrupt!',
                    'metadata': {
                        'sha256': hashlib.sha256(payload).hexdigest(),
                        'format': 'ltbk1',
                    },
                },
            })
            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                result = sync_encrypted_backups_to_s3(root, client=client)

            self.assertEqual(result.pending, (archive,))
            self.assertTrue(result.errors)
            self.assertEqual(list(root.glob('.*.s3-ok.json')), [])

    def test_remote_integrity_error_removes_existing_marker(self):
        payload = b'LTBK1expected'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_bad_metadata.ltbk'
            archive.write_bytes(payload)
            client = FakeS3Client()
            key = 'tenant/backups/' + archive.name

            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                initial = sync_encrypted_backups_to_s3(root, client=client)
                marker = root / f'.{archive.name}.s3-ok.json'
                self.assertTrue(marker.is_file())
                client.objects[('libtak-test-backups', key)]['metadata'][
                    'sha256'
                ] = '0' * 64
                failed = sync_encrypted_backups_to_s3(
                    root,
                    client=client,
                )

            self.assertEqual(initial.confirmed, frozenset({archive}))
            self.assertEqual(failed.confirmed, frozenset())
            self.assertEqual(failed.pending, (archive,))
            self.assertTrue(failed.errors)
            self.assertFalse(marker.exists())
            self.assertEqual(len(client.uploads), 1)

    def test_replaced_remote_body_after_marker_is_pending(self):
        payload = b'LTBK1original'
        replacement = b'LTBK1tampered'
        self.assertEqual(len(payload), len(replacement))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'libtak_backup_replaced.ltbk'
            archive.write_bytes(payload)
            client = FakeS3Client()
            key = 'tenant/backups/' + archive.name

            with patch.dict(os.environ, S3_ENVIRONMENT, clear=True):
                initial = sync_encrypted_backups_to_s3(root, client=client)
                marker = root / f'.{archive.name}.s3-ok.json'
                initial_metadata = dict(
                    client.objects[('libtak-test-backups', key)]['metadata']
                )
                client.objects[('libtak-test-backups', key)]['body'] = replacement
                replaced = sync_encrypted_backups_to_s3(
                    root,
                    client=client,
                    force_body_verification=True,
                )

            self.assertEqual(initial.confirmed, frozenset({archive}))
            self.assertEqual(
                client.objects[('libtak-test-backups', key)]['metadata'],
                initial_metadata,
            )
            self.assertEqual(replaced.confirmed, frozenset())
            self.assertEqual(replaced.pending, (archive,))
            self.assertTrue(replaced.errors)
            self.assertFalse(marker.exists())
            self.assertEqual(len(client.uploads), 1)
            self.assertEqual(len(client.get_calls), 2)


class S3BackupTaskIntegrationTest(TestCase):
    def _database_settings(self, root):
        source_db = root / 'source.sqlite3'
        with closing(sqlite3.connect(source_db)) as connection:
            connection.execute('CREATE TABLE django_migrations (id INTEGER)')
            connection.execute('CREATE TABLE core_user (id INTEGER)')
            connection.commit()
        return {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': source_db,
            },
        }

    def test_s3_exception_never_deletes_local_or_leaks_exception_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            media_dir = root / 'media'
            media_dir.mkdir()
            key = base64.urlsafe_b64encode(b's' * 32).decode('ascii')
            environment = {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_OFFSITE_DIR': '',
                'BACKUP_ENCRYPTION_KEY': key,
                'BACKUP_RETENTION_DAYS': '30',
                'BACKUP_S3_BUCKET': 'bucket',
            }
            with override_settings(
                DATABASES=self._database_settings(root),
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, environment, clear=True), patch(
                'reporting.tasks.sync_encrypted_backups_to_s3',
                side_effect=RuntimeError('credential-canary-must-not-leak'),
            ), patch(
                'reporting.tasks.ReportLog.objects.create'
            ) as report_log, patch(
                'reporting.tasks.logger.warning'
            ) as warning:
                result = str(daily_database_backup())

            archive = Path(result.split(': ', 1)[1])
            self.assertTrue(result.startswith('Backup created: '), result)
            self.assertTrue(archive.is_file())
            log_arguments = ' '.join(
                str(argument)
                for call in warning.call_args_list
                for argument in call.args
            )
            recorded_error = report_log.call_args.kwargs['error_message']
            self.assertNotIn('credential-canary-must-not-leak', log_arguments)
            self.assertNotIn('credential-canary-must-not-leak', recorded_error)
            self.assertIn('s3: RuntimeError', recorded_error)
            self.assertEqual(
                report_log.call_args.kwargs['recipients'],
                'encrypted-local-storage',
            )

    def test_structural_verification_failure_never_finalizes_archive(self):
        validation_targets = (
            'decrypt_archive',
            'validate_zip_archive',
        )
        for target in validation_targets:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                backup_dir = root / 'backups'
                media_dir = root / 'media'
                media_dir.mkdir()
                key = base64.urlsafe_b64encode(b'v' * 32).decode('ascii')
                environment = {
                    'BACKUP_DIR': str(backup_dir),
                    'BACKUP_OFFSITE_DIR': '',
                    'BACKUP_ENCRYPTION_KEY': key,
                    'BACKUP_RETENTION_DAYS': '30',
                    'BACKUP_S3_BUCKET': '',
                }
                with override_settings(
                    DATABASES=self._database_settings(root),
                    MEDIA_ROOT=media_dir,
                ), patch.dict(os.environ, environment, clear=True), patch(
                    f'reporting.tasks.{target}',
                    side_effect=BackupValidationError(
                        'structural-validation-canary'
                    ),
                ), patch(
                    'reporting.tasks.ReportLog.objects.create'
                ) as report_log:
                    result = str(daily_database_backup())

                self.assertTrue(result.startswith('Backup failed: '), result)
                self.assertEqual(list(backup_dir.glob('*.ltbk')), [])
                self.assertEqual(list(backup_dir.iterdir()), [])
                self.assertFalse(report_log.call_args.kwargs['success'])
                self.assertIn(
                    'structural-validation-canary',
                    report_log.call_args.kwargs['error_message'],
                )

    def test_expired_pending_archive_is_retained_until_s3_confirms_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            backup_dir.mkdir()
            old_archive = backup_dir / 'libtak_backup_old.ltbk'
            old_archive.write_bytes(b'LTBK1pending-old')
            old_time = time.time() - (10 * 24 * 60 * 60)
            os.utime(old_archive, (old_time, old_time))
            media_dir = root / 'media'
            media_dir.mkdir()
            key = base64.urlsafe_b64encode(b'r' * 32).decode('ascii')

            def pending_result(
                directory_path,
                *,
                force_body_verification=False,
            ):
                archives = tuple(sorted(directory_path.glob('*.ltbk')))
                return OffsiteS3SyncResult(
                    enabled=True,
                    archives=len(archives),
                    pending=archives,
                    errors=tuple(
                        f'{archive.name}: RuntimeError' for archive in archives
                    ),
                )

            environment = {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_OFFSITE_DIR': '',
                'BACKUP_ENCRYPTION_KEY': key,
                'BACKUP_RETENTION_DAYS': '1',
                'BACKUP_S3_BUCKET': 'bucket',
            }
            with override_settings(
                DATABASES=self._database_settings(root),
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, environment, clear=True), patch(
                'reporting.tasks.sync_encrypted_backups_to_s3',
                side_effect=pending_result,
            ), patch('reporting.tasks.ReportLog.objects.create'):
                result = str(daily_database_backup())

            self.assertTrue(result.startswith('Backup created: '), result)
            self.assertTrue(old_archive.is_file())

    def test_expired_confirmed_archive_and_its_marker_are_purged_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup_dir = root / 'backups'
            backup_dir.mkdir()
            old_archive = backup_dir / 'libtak_backup_old.ltbk'
            old_archive.write_bytes(b'LTBK1confirmed-old')
            old_marker = backup_dir / f'.{old_archive.name}.s3-ok.json'
            old_marker.write_text('{"confirmed": true}', encoding='utf-8')
            old_time = time.time() - (10 * 24 * 60 * 60)
            os.utime(old_archive, (old_time, old_time))
            os.utime(old_marker, (old_time, old_time))
            media_dir = root / 'media'
            media_dir.mkdir()
            key = base64.urlsafe_b64encode(b'p' * 32).decode('ascii')

            forced_verification_calls = []

            def confirmed_result(
                directory_path,
                *,
                force_body_verification=False,
            ):
                forced_verification_calls.append(
                    frozenset(force_body_verification)
                )
                archives = tuple(sorted(directory_path.glob('*.ltbk')))
                return OffsiteS3SyncResult(
                    enabled=True,
                    archives=len(archives),
                    verified=len(archives),
                    confirmed=frozenset(archives),
                )

            environment = {
                'BACKUP_DIR': str(backup_dir),
                'BACKUP_OFFSITE_DIR': '',
                'BACKUP_ENCRYPTION_KEY': key,
                'BACKUP_RETENTION_DAYS': '1',
                'BACKUP_S3_BUCKET': 'bucket',
            }
            with override_settings(
                DATABASES=self._database_settings(root),
                MEDIA_ROOT=media_dir,
            ), patch.dict(os.environ, environment, clear=True), patch(
                'reporting.tasks.sync_encrypted_backups_to_s3',
                side_effect=confirmed_result,
            ), patch('reporting.tasks.ReportLog.objects.create'):
                result = str(daily_database_backup())

            current_archive = Path(result.split(': ', 1)[1])
            self.assertTrue(result.startswith('Backup created: '), result)
            self.assertTrue(current_archive.is_file())
            self.assertFalse(old_archive.exists())
            self.assertFalse(old_marker.exists())
            self.assertEqual(len(forced_verification_calls), 2)
            self.assertIn(old_archive, forced_verification_calls[0])
            self.assertEqual(forced_verification_calls[1], frozenset())
            self.assertNotIn(current_archive, forced_verification_calls[1])


class SyncOffsiteBackupsCommandTest(SimpleTestCase):
    def test_success_reports_explicit_counts(self):
        result = OffsiteS3SyncResult(
            enabled=True,
            archives=3,
            uploaded=2,
            verified=3,
            confirmed=frozenset(),
        )
        stdout = io.StringIO()
        with patch(
            'reporting.management.commands.sync_offsite_backups.'
            'secure_backup_directory',
            return_value=Path('C:/private-backups'),
        ), patch(
            'reporting.management.commands.sync_offsite_backups.'
            'sync_encrypted_backups_to_s3',
            return_value=result,
        ) as sync:
            call_command('sync_offsite_backups', stdout=stdout)

        sync.assert_called_once_with(Path('C:/private-backups'))
        self.assertIn(
            'offsite-s3: 3/3 verified, 2 uploaded, 0 pending',
            stdout.getvalue(),
        )

    def test_failure_does_not_echo_exception_text_or_credentials(self):
        stdout = io.StringIO()
        stderr = io.StringIO()
        canaries = (
            'access-key-canary',
            'secret-key-canary',
            'session-token-canary',
        )
        exception_text = ' '.join(canaries)
        with patch(
            'reporting.management.commands.sync_offsite_backups.'
            'secure_backup_directory',
            return_value=Path('C:/private-backups'),
        ), patch(
            'reporting.management.commands.sync_offsite_backups.'
            'sync_encrypted_backups_to_s3',
            side_effect=RuntimeError(exception_text),
        ):
            with self.assertRaises(CommandError) as raised:
                call_command(
                    'sync_offsite_backups',
                    stdout=stdout,
                    stderr=stderr,
                )

        visible_text = ' '.join((
            str(raised.exception),
            stdout.getvalue(),
            stderr.getvalue(),
        ))
        self.assertIsNone(raised.exception.__cause__)
        self.assertTrue(raised.exception.__suppress_context__)
        formatted_traceback = ''.join(
            traceback.format_exception(raised.exception)
        )
        for canary in canaries:
            self.assertNotIn(canary, visible_text)
            self.assertNotIn(canary, formatted_traceback)
        self.assertIn('RuntimeError', visible_text)
