"""Optional S3-compatible transport for encrypted LibTak backups.

The local ``.ltbk`` archive remains the source of truth.  When S3 is
configured, every retained archive is uploaded under an immutable unique name
and verified through its size and SHA-256 metadata.  The implementation never
deletes remote objects; retention and Object Lock belong to the bucket policy.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
from urllib.parse import urlsplit

from django.conf import settings


_ARCHIVE_NAME_PATTERN = re.compile(
    r'\Alibtak_backup_[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.ltbk\Z'
)


class OffsiteS3ConfigurationError(ValueError):
    """Raised before network access when the S3 configuration is unsafe."""


class OffsiteS3IntegrityError(OSError):
    """Raised when an existing or uploaded remote object cannot be trusted."""


@dataclass(frozen=True)
class OffsiteS3Config:
    bucket: str
    prefix: str
    endpoint_url: str | None
    region_name: str | None
    access_key_id: str | None = field(repr=False)
    secret_access_key: str | None = field(repr=False)
    session_token: str | None = field(repr=False)


@dataclass(frozen=True)
class OffsiteS3SyncResult:
    enabled: bool
    archives: int = 0
    uploaded: int = 0
    verified: int = 0
    confirmed: frozenset[Path] = frozenset()
    pending: tuple[Path, ...] = ()
    pending_bytes: int = 0
    errors: tuple[str, ...] = ()


def secure_backup_directory() -> Path:
    """Return the canonical directory used for finalized encrypted archives."""
    return Path(
        os.environ.get('BACKUP_DIR')
        or os.environ.get('LIBTAK_BACKUP_DIR')
        or (Path(settings.BASE_DIR).parent / '.libtak-secure-backups')
    ).expanduser().resolve()


def _clean_optional(name: str) -> str | None:
    value = os.environ.get(name, '').strip()
    return value or None


def load_s3_config() -> OffsiteS3Config | None:
    """Load and validate S3 settings without contacting the provider."""
    bucket = _clean_optional('BACKUP_S3_BUCKET')
    if not bucket:
        return None
    if (
        len(bucket) > 255
        or '/' in bucket
        or '\\' in bucket
        or any(character.isspace() or ord(character) < 32 for character in bucket)
    ):
        raise OffsiteS3ConfigurationError(
            'BACKUP_S3_BUCKET must be a single safe bucket name.'
        )

    endpoint_url = _clean_optional('BACKUP_S3_ENDPOINT_URL')
    if endpoint_url:
        try:
            parsed = urlsplit(endpoint_url)
            parsed.port
        except ValueError:
            raise OffsiteS3ConfigurationError(
                'BACKUP_S3_ENDPOINT_URL must be a credential-free HTTPS URL.'
            ) from None
        if (
            parsed.scheme.lower() != 'https'
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in ('', '/')
            or parsed.query
            or parsed.fragment
        ):
            raise OffsiteS3ConfigurationError(
                'BACKUP_S3_ENDPOINT_URL must be a credential-free HTTPS URL.'
            )

    prefix_value = _clean_optional('BACKUP_S3_PREFIX') or 'libtak/backups'
    if '\\' in prefix_value or any(ord(character) < 32 for character in prefix_value):
        raise OffsiteS3ConfigurationError(
            'BACKUP_S3_PREFIX must be a safe POSIX object prefix.'
        )
    prefix_parts = PurePosixPath(prefix_value.strip('/')).parts
    if not prefix_parts or any(part in ('', '.', '..') for part in prefix_parts):
        raise OffsiteS3ConfigurationError(
            'BACKUP_S3_PREFIX must not contain relative path segments.'
        )
    prefix = '/'.join(prefix_parts)

    region_name = _clean_optional('BACKUP_S3_REGION')
    if endpoint_url and not region_name:
        raise OffsiteS3ConfigurationError(
            'A custom S3 endpoint requires an explicit BACKUP_S3_REGION.'
        )

    access_key_id = _clean_optional('BACKUP_S3_ACCESS_KEY_ID')
    secret_access_key = _clean_optional('BACKUP_S3_SECRET_ACCESS_KEY')
    session_token = _clean_optional('BACKUP_S3_SESSION_TOKEN')
    if bool(access_key_id) != bool(secret_access_key):
        raise OffsiteS3ConfigurationError(
            'BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY '
            'must be configured together.'
        )
    if session_token and not access_key_id:
        raise OffsiteS3ConfigurationError(
            'BACKUP_S3_SESSION_TOKEN requires explicit S3 access credentials.'
        )
    if endpoint_url and not access_key_id:
        raise OffsiteS3ConfigurationError(
            'A custom S3 endpoint requires explicit backup-only credentials.'
        )

    return OffsiteS3Config(
        bucket=bucket,
        prefix=prefix,
        endpoint_url=endpoint_url,
        region_name=region_name,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        session_token=session_token,
    )


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _build_s3_client(config: OffsiteS3Config):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover - dependency is CI-verified.
        raise OffsiteS3ConfigurationError(
            'boto3 must be installed before S3 backups can be enabled.'
        ) from exc

    options = {}
    if config.endpoint_url:
        options['endpoint_url'] = config.endpoint_url
    if config.region_name:
        options['region_name'] = config.region_name
    if config.access_key_id:
        options['aws_access_key_id'] = config.access_key_id
        options['aws_secret_access_key'] = config.secret_access_key
    if config.session_token:
        options['aws_session_token'] = config.session_token
    options['config'] = Config(
        connect_timeout=10,
        ignore_configured_endpoint_urls=True,
        read_timeout=60,
        retries={'mode': 'standard', 'max_attempts': 5},
        signature_version='s3v4',
    )
    return boto3.client('s3', **options)


def _is_missing_object(exc: Exception) -> bool:
    response = getattr(exc, 'response', {}) or {}
    error = response.get('Error', {}) or {}
    metadata = response.get('ResponseMetadata', {}) or {}
    code = str(error.get('Code', '')).lower()
    status = metadata.get('HTTPStatusCode')
    return code in {'404', 'nosuchkey', 'notfound'} or (
        status == 404 and not code
    )


def _is_global_s3_failure(exc: Exception) -> bool:
    """Stop retrying every archive when the provider itself is unavailable."""
    response = getattr(exc, 'response', {}) or {}
    error = response.get('Error', {}) or {}
    metadata = response.get('ResponseMetadata', {}) or {}
    code = str(error.get('Code', '')).lower()
    status = metadata.get('HTTPStatusCode')
    global_codes = {
        'accessdenied',
        'allaccessdisabled',
        'authorizationheadermalformed',
        'expiredtoken',
        'internalerror',
        'invalidaccesskeyid',
        'invalidbucketname',
        'invalidtoken',
        'nosuchbucket',
        'permanentredirect',
        'requesttimeout',
        'requesttimetoolskewed',
        'servicunavailable',
        'serviceunavailable',
        'signaturedoesnotmatch',
        'slowdown',
    }
    transport_types = {
        'BotoCoreError',
        'ConnectTimeoutError',
        'ConnectionClosedError',
        'EndpointConnectionError',
        'HTTPClientError',
        'NoCredentialsError',
        'PartialCredentialsError',
        'ProxyConnectionError',
        'ReadTimeoutError',
        'SSLError',
    }
    return (
        code in global_codes
        or type(exc).__name__ in transport_types
        or status in {301, 307, 401, 403, 408, 429}
        or (isinstance(status, int) and 500 <= status <= 599)
    )


def safe_s3_error(exc: Exception) -> str:
    """Return diagnostics that cannot echo credentials from an exception."""
    response = getattr(exc, 'response', {}) or {}
    metadata = response.get('ResponseMetadata', {}) or {}
    status = metadata.get('HTTPStatusCode')
    if isinstance(status, int) and 100 <= status <= 599:
        return f'{type(exc).__name__} (HTTP {status})'
    return type(exc).__name__


def _head_object(client, config: OffsiteS3Config, key: str):
    try:
        return client.head_object(Bucket=config.bucket, Key=key)
    except Exception as exc:
        if _is_missing_object(exc):
            return None
        raise


def _verify_remote_head(head, *, archive: Path, sha256: str) -> None:
    metadata = {
        str(key).lower(): str(value)
        for key, value in (head.get('Metadata', {}) or {}).items()
    }
    if (
        int(head.get('ContentLength', -1)) != archive.stat().st_size
        or metadata.get('sha256') != sha256
        or metadata.get('format') != 'ltbk1'
    ):
        raise OffsiteS3IntegrityError(
            f'Remote integrity metadata mismatch for {archive.name}.'
        )


def _marker_path(archive: Path) -> Path:
    return archive.with_name(f'.{archive.name}.s3-ok.json')


def _archive_fingerprint(archive: Path) -> dict[str, int]:
    stat = archive.stat()
    return {
        'size': stat.st_size,
        'mtime_ns': stat.st_mtime_ns,
        'device': stat.st_dev,
        'inode': stat.st_ino,
    }


def _remote_identity(response) -> dict[str, str]:
    """Return opaque object identity tokens; ETag is never treated as a hash."""
    identity = {}
    raw_version_id = response.get('VersionId')
    version_id = raw_version_id.strip() if isinstance(raw_version_id, str) else ''
    if version_id and version_id.lower() != 'null' and len(version_id) <= 1024:
        identity['version_id'] = version_id
    raw_etag = response.get('ETag')
    etag = raw_etag.strip() if isinstance(raw_etag, str) else ''
    if etag and len(etag) <= 512:
        identity['etag'] = etag
    return identity


def _same_remote_identity(expected, response) -> bool:
    if not isinstance(expected, dict):
        return False
    expected_tokens = {
        key: value
        for key, value in expected.items()
        if key in {'version_id', 'etag'} and isinstance(value, str) and value
    }
    observed = _remote_identity(response)
    return bool(expected_tokens) and all(
        observed.get(key) == value for key, value in expected_tokens.items()
    )


def _read_valid_marker(
    archive: Path,
    *,
    config: OffsiteS3Config,
    key: str,
) -> dict | None:
    marker = _marker_path(archive)
    try:
        if (
            not marker.is_file()
            or marker.is_symlink()
            or marker.resolve().parent != archive.parent.resolve()
            or marker.stat().st_size > 4096
        ):
            return None
        contents = json.loads(marker.read_text(encoding='utf-8'))
    except (FileNotFoundError, OSError, ValueError, TypeError):
        return None
    if not isinstance(contents, dict):
        return None
    sha256 = contents.get('sha256')
    fingerprint = contents.get('local_fingerprint')
    if not (
        contents.get('bucket') == config.bucket
        and contents.get('key') == key
        and isinstance(sha256, str)
        and len(sha256) == 64
        and all(character in '0123456789abcdef' for character in sha256)
        and isinstance(fingerprint, dict)
        and fingerprint == _archive_fingerprint(archive)
    ):
        return None
    return contents


def _write_marker(
    archive: Path,
    *,
    config: OffsiteS3Config,
    key: str,
    sha256: str,
    remote_identity: dict[str, str],
) -> None:
    marker = _marker_path(archive)
    temporary = marker.with_name(
        f'{marker.name}.{secrets.token_hex(8)}.tmp'
    )
    payload = {
        'bucket': config.bucket,
        'key': key,
        'sha256': sha256,
        'local_fingerprint': _archive_fingerprint(archive),
        'remote_identity': remote_identity,
        'verified_at': datetime.now(timezone.utc).isoformat(),
    }
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(payload, stream, ensure_ascii=True, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, marker)
        _fsync_directory(marker.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def remove_s3_marker(archive: Path) -> None:
    """Remove local upload state after the matching local archive is purged."""
    _marker_path(archive).unlink(missing_ok=True)


def _fsync_directory(directory: Path) -> None:
    """Persist atomic renames on POSIX; Windows cannot open directories this way."""
    if os.name == 'nt':
        return
    flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
    descriptor = os.open(directory, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _validate_encrypted_archive(archive: Path) -> None:
    """Reject unrelated files before they can be copied to off-site storage."""
    with archive.open('rb') as stream:
        magic = stream.read(5)
    if magic != b'LTBK1':
        raise OffsiteS3IntegrityError(
            f'Invalid encrypted backup header for {archive.name}.'
        )


def _verify_remote_body(
    client,
    config: OffsiteS3Config,
    key: str,
    *,
    archive: Path,
    sha256: str,
    head,
) -> dict[str, str]:
    expected_identity = _remote_identity(head)
    request = {'Bucket': config.bucket, 'Key': key}
    if 'version_id' in expected_identity:
        request['VersionId'] = expected_identity['version_id']
    response = client.get_object(**request)
    body = response['Body']
    digest = hashlib.sha256()
    size = 0
    try:
        if expected_identity and not _same_remote_identity(
            expected_identity, response
        ):
            raise OffsiteS3IntegrityError(
                f'Remote object identity changed for {archive.name}.'
            )
        while chunk := body.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    finally:
        body.close()
    if size != archive.stat().st_size or digest.hexdigest() != sha256:
        raise OffsiteS3IntegrityError(
            f'Remote content checksum mismatch for {archive.name}.'
        )
    return expected_identity or _remote_identity(response)


def sync_encrypted_backups_to_s3(
    backup_dir: Path | None = None,
    *,
    client=None,
    force_body_verification: bool | Collection[Path] = False,
) -> OffsiteS3SyncResult:
    """Upload or verify every retained encrypted archive, without deletion."""
    config = load_s3_config()
    if not config:
        return OffsiteS3SyncResult(enabled=False)

    directory = (backup_dir or secure_backup_directory()).expanduser().resolve()
    if not directory.is_dir():
        raise FileNotFoundError('The local encrypted backup directory is missing.')

    archives = []
    for candidate in sorted(directory.glob('libtak_backup_*.ltbk')):
        if (
            candidate.is_file()
            and not candidate.is_symlink()
            and candidate.resolve().parent == directory
            and _ARCHIVE_NAME_PATTERN.fullmatch(candidate.name)
        ):
            archives.append(candidate)

    if not archives:
        return OffsiteS3SyncResult(enabled=True)

    if force_body_verification is True:
        force_paths = {archive.resolve() for archive in archives}
    elif force_body_verification is False:
        force_paths = set()
    else:
        force_paths = {
            Path(path).expanduser().resolve() for path in force_body_verification
        }
    s3_client = client or _build_s3_client(config)
    uploaded = 0
    verified = 0
    confirmed = set()
    errors = []
    for archive in archives:
        marker = None
        try:
            _validate_encrypted_archive(archive)
            key = f'{config.prefix}/{archive.name}'
            marker = _read_valid_marker(
                archive,
                config=config,
                key=key,
            )
            if marker is None and _marker_path(archive).exists():
                remove_s3_marker(archive)
            head = _head_object(s3_client, config, key)
            marker_valid = bool(
                marker
                and head is not None
                and _same_remote_identity(marker.get('remote_identity'), head)
            )
            force_body = archive.resolve() in force_paths

            if marker_valid and not force_body:
                sha256 = marker['sha256']
                _verify_remote_head(head, archive=archive, sha256=sha256)
                if _archive_fingerprint(archive) != marker['local_fingerprint']:
                    raise OffsiteS3IntegrityError(
                        f'Local archive changed during verification for {archive.name}.'
                    )
                confirmed.add(archive)
                verified += 1
                continue

            fingerprint = _archive_fingerprint(archive)
            sha256 = _file_sha256(archive)
            if _archive_fingerprint(archive) != fingerprint:
                raise OffsiteS3IntegrityError(
                    f'Local archive changed during verification for {archive.name}.'
                )
            if head is None:
                s3_client.upload_file(
                    str(archive),
                    config.bucket,
                    key,
                    ExtraArgs={
                        'ContentType': 'application/octet-stream',
                        'Metadata': {'sha256': sha256, 'format': 'ltbk1'},
                    },
                )
                uploaded += 1
                head = _head_object(s3_client, config, key)
                if head is None:
                    raise OffsiteS3IntegrityError(
                        f'Uploaded object is not visible for {archive.name}.'
                    )
            _verify_remote_head(head, archive=archive, sha256=sha256)
            verified_identity = _verify_remote_body(
                s3_client,
                config,
                key,
                archive=archive,
                sha256=sha256,
                head=head,
            )
            final_head = _head_object(s3_client, config, key)
            if final_head is None:
                raise OffsiteS3IntegrityError(
                    f'Verified object disappeared for {archive.name}.'
                )
            _verify_remote_head(final_head, archive=archive, sha256=sha256)
            if verified_identity and not _same_remote_identity(
                verified_identity, final_head
            ):
                raise OffsiteS3IntegrityError(
                    f'Remote object changed after verification for {archive.name}.'
                )
            if _archive_fingerprint(archive) != fingerprint:
                raise OffsiteS3IntegrityError(
                    f'Local archive changed during upload for {archive.name}.'
                )
            _write_marker(
                archive,
                config=config,
                key=key,
                sha256=sha256,
                remote_identity=_remote_identity(final_head),
            )
            confirmed.add(archive)
            verified += 1
        except Exception as exc:
            if isinstance(exc, OffsiteS3IntegrityError):
                try:
                    remove_s3_marker(archive)
                except OSError:
                    pass
            errors.append(f'{archive.name}: {safe_s3_error(exc)}')
            if _is_global_s3_failure(exc):
                break

    pending = tuple(archive for archive in archives if archive not in confirmed)
    pending_bytes = 0
    for archive in pending:
        try:
            pending_bytes += archive.stat().st_size
        except FileNotFoundError:
            continue

    return OffsiteS3SyncResult(
        enabled=True,
        archives=len(archives),
        uploaded=uploaded,
        verified=verified,
        confirmed=frozenset(confirmed),
        pending=pending,
        pending_bytes=pending_bytes,
        errors=tuple(errors),
    )
