import os
import base64
import subprocess
import sys
import tempfile
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework import serializers
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from config.settings import _cloud_api_url_uses_secure_transport
from ensure_local_env import ensure_local_env
from core.image_validators import validate_image_upload
from core.middleware import RequestSizeLimitMiddleware
from core.models import User
from core.security import purge_expired_refresh_tokens
from core.upload_handlers import UploadSizeGuard


def image_upload(name='test.png', image_format='PNG', content_type='image/png', size=(2, 2)):
    payload = BytesIO()
    Image.new('RGB', size, 'white').save(payload, format=image_format)
    return SimpleUploadedFile(name, payload.getvalue(), content_type=content_type)


class CloudApiTransportSecurityTest(SimpleTestCase):
    def test_https_and_exact_loopback_http_are_allowed(self):
        allowed = (
            'https://api.example.test/api',
            'http://localhost:8000/api',
            'http://127.0.0.1:8000/api',
            'http://127.42.0.9/api',
            'http://[::1]:8000/api',
        )
        for url in allowed:
            with self.subTest(url=url):
                self.assertTrue(_cloud_api_url_uses_secure_transport(url))

    def test_remote_http_and_malformed_urls_are_rejected(self):
        rejected = (
            'http://api.example.test/api',
            'http://localhost.example.test/api',
            '//api.example.test/api',
            'ftp://api.example.test/api',
            'https://' + 'user:password' + '@api.example.test/api',
            'https://api.example.test:invalid/api',
            'https://api.example.test/api#fragment',
        )
        for url in rejected:
            with self.subTest(url=url):
                self.assertFalse(_cloud_api_url_uses_secure_transport(url))

    def test_production_settings_fail_closed_for_remote_http(self):
        environment = os.environ.copy()
        environment.update({
            'DEBUG': 'False',
            'SECRET_KEY': 's' * 60,
            'JWT_SIGNING_KEY': 'j' * 60,
            'CLOUD_API_URL': 'http://api.example.test/api',
            'SYNC_TOKEN': 't' * 40,
            'IS_CLOUD_SERVER': 'False',
        })
        result = subprocess.run(
            [sys.executable, '-c', 'import config.settings'],
            cwd=settings.BASE_DIR,
            env=environment,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)

    def test_windows_launcher_runs_idempotent_environment_upgrade(self):
        launcher = (
            settings.BASE_DIR.parent / 'start_local_server.bat'
        ).read_text(encoding='utf-8')
        self.assertIn('ensure_local_env.py ".env"', launcher)
        self.assertIn(
            'manage.py createsuperuser\n    if errorlevel 1 goto :failure',
            launcher,
        )

    def test_local_environment_upgrade_adds_backup_key_without_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / '.env'
            existing_secret = 'existing-secret-' + ('s' * 50)
            existing_jwt = 'existing-jwt-' + ('j' * 50)
            env_path.write_text(
                f'SECRET_KEY={existing_secret}\n'
                f'JWT_SIGNING_KEY={existing_jwt}\n'
                'DEBUG=True\n'
                'BACKUP_ENCRYPTION_KEY=\n',
                encoding='utf-8',
            )

            ensure_local_env(env_path)
            first = env_path.read_text(encoding='utf-8')
            values = dict(
                line.split('=', 1)
                for line in first.splitlines()
                if line and not line.startswith('#') and '=' in line
            )
            self.assertEqual(values['SECRET_KEY'], existing_secret)
            self.assertEqual(values['JWT_SIGNING_KEY'], existing_jwt)
            self.assertEqual(values['DEBUG'], 'True')
            self.assertEqual(
                len(base64.urlsafe_b64decode(values['BACKUP_ENCRYPTION_KEY'])),
                32,
            )
            self.assertEqual(values['BACKUP_RETENTION_DAYS'], '30')

            ensure_local_env(env_path)
            self.assertEqual(env_path.read_text(encoding='utf-8'), first)

    def test_new_local_environment_uses_production_guards_on_loopback(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / '.env'
            ensure_local_env(env_path)
            contents = env_path.read_text(encoding='utf-8')

        self.assertIn('DEBUG=False\n', contents)
        self.assertIn('SECURE_SSL_REDIRECT=False\n', contents)

    def test_pythonanywhere_receiver_role_is_part_of_deployment_setup(self):
        repository_root = settings.BASE_DIR.parent
        deploy_guide = (repository_root / 'DEPLOY.md').read_text(
            encoding='utf-8'
        )
        wsgi_template = (
            repository_root / 'deployment' / 'pythonanywhere_wsgi.py'
        ).read_text(encoding='utf-8')

        self.assertIn('`IS_CLOUD_SERVER` | `True`', deploy_guide)
        self.assertIn(
            "os.environ.setdefault('IS_CLOUD_SERVER', 'True')",
            wsgi_template,
        )


class UploadSecurityTest(SimpleTestCase):
    def test_valid_image_is_accepted_and_stream_position_is_restored(self):
        upload = image_upload()
        upload.seek(1)
        self.assertIs(validate_image_upload(upload), upload)
        self.assertEqual(upload.tell(), 1)

    def test_corrupt_image_and_claimed_mime_mismatch_are_rejected(self):
        corrupt = SimpleUploadedFile(
            'broken.png', b'not-an-image', content_type='image/png'
        )
        with self.assertRaises(serializers.ValidationError):
            validate_image_upload(corrupt)

        with self.assertRaises(serializers.ValidationError):
            validate_image_upload(image_upload(content_type='image/jpeg'))

    def test_decoded_pixel_and_encoded_byte_limits_are_enforced(self):
        with patch('core.image_validators.MAX_IMAGE_PIXELS', 3):
            with self.assertRaises(serializers.ValidationError):
                validate_image_upload(image_upload(size=(2, 2)))

        oversized = SimpleUploadedFile(
            'large.png',
            b'x' * (2 * 1024 * 1024 + 1),
            content_type='image/png',
        )
        with self.assertRaises(serializers.ValidationError):
            validate_image_upload(oversized)

    @override_settings(MAX_REQUEST_BODY_SIZE=100)
    def test_declared_oversized_request_is_rejected_before_view(self):
        called = False

        def downstream(request):
            nonlocal called
            called = True
            raise AssertionError('downstream should not run')

        request = RequestFactory().generic(
            'POST',
            '/api/upload/',
            data=b'',
            content_type='application/octet-stream',
        )
        request.META['CONTENT_LENGTH'] = '101'
        response = RequestSizeLimitMiddleware(downstream)(request)
        self.assertEqual(response.status_code, 413)
        self.assertFalse(called)

    @override_settings(MAX_SINGLE_FILE_UPLOAD_SIZE=3)
    def test_chunked_file_guard_enforces_streaming_limit(self):
        guard = UploadSizeGuard()
        guard.new_file('image', 'test.png', 'image/png', None, None)
        self.assertEqual(guard.receive_data_chunk(b'12', 0), b'12')
        with self.assertRaises(RequestDataTooBig):
            guard.receive_data_chunk(b'34', 2)

    @override_settings(
        MAX_SINGLE_FILE_UPLOAD_SIZE=10,
        MAX_REQUEST_BODY_SIZE=3,
    )
    def test_streaming_guard_limits_multiple_files_in_one_request(self):
        guard = UploadSizeGuard()
        guard.new_file('first', 'one.png', 'image/png', None, None)
        self.assertEqual(guard.receive_data_chunk(b'12', 0), b'12')
        guard.new_file('second', 'two.png', 'image/png', None, None)
        with self.assertRaises(RequestDataTooBig):
            guard.receive_data_chunk(b'34', 0)


class ExpiredJwtCleanupTest(TestCase):
    def test_only_expired_outstanding_tokens_are_deleted(self):
        user = User.objects.create_user(
            username='jwt-cleanup-user',
            password='A-long-test-passphrase-2026!',
        )
        expired_token = RefreshToken.for_user(user)
        live_token = RefreshToken.for_user(user)
        now = timezone.now()
        OutstandingToken.objects.filter(jti=expired_token['jti']).update(
            expires_at=now - timedelta(minutes=1)
        )
        OutstandingToken.objects.filter(jti=live_token['jti']).update(
            expires_at=now + timedelta(minutes=1)
        )

        self.assertEqual(purge_expired_refresh_tokens(now=now), 1)
        self.assertFalse(
            OutstandingToken.objects.filter(jti=expired_token['jti']).exists()
        )
        self.assertTrue(
            OutstandingToken.objects.filter(jti=live_token['jti']).exists()
        )

    def test_celery_schedule_keeps_scheduler_and_security_cleanup(self):
        schedule = settings.CELERY_BEAT_SCHEDULE
        self.assertEqual(
            schedule['scheduled-reports']['task'],
            'reporting.tasks.run_scheduled_reports',
        )
        self.assertEqual(
            schedule['purge-expired-jwt-tokens']['task'],
            'core.tasks.purge_expired_jwt_tokens',
        )
