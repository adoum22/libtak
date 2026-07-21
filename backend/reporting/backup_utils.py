import base64
import hashlib
import json
import os
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.exceptions import InvalidTag


class BackupValidationError(ValueError):
    pass


def encryption_key_from_env():
    encoded = os.environ.get('BACKUP_ENCRYPTION_KEY', '')
    try:
        key = base64.urlsafe_b64decode(encoded.encode('ascii'))
    except Exception as exc:
        raise BackupValidationError(
            'BACKUP_ENCRYPTION_KEY is not valid base64.',
        ) from exc
    if len(key) != 32:
        raise BackupValidationError(
            'BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.',
        )
    return key


def _sha256_stream(stream):
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def decrypt_archive(encrypted_path, decrypted_path):
    encrypted_path = Path(encrypted_path).resolve()
    decrypted_path = Path(decrypted_path).resolve()
    size = encrypted_path.stat().st_size
    header_size = 5 + 12
    tag_size = 16
    if size <= header_size + tag_size:
        raise BackupValidationError('Backup file is truncated.')

    with encrypted_path.open('rb') as source:
        if source.read(5) != b'LTBK1':
            raise BackupValidationError('Unsupported backup format.')
        nonce = source.read(12)
        source.seek(-tag_size, os.SEEK_END)
        tag = source.read(tag_size)
        source.seek(header_size)
        remaining = size - header_size - tag_size
        decryptor = Cipher(
            algorithms.AES(encryption_key_from_env()),
            modes.GCM(nonce, tag),
        ).decryptor()
        try:
            with decrypted_path.open('wb') as target:
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise BackupValidationError('Backup ciphertext is truncated.')
                    remaining -= len(chunk)
                    target.write(decryptor.update(chunk))
                target.write(decryptor.finalize())
        except (InvalidTag, ValueError) as exc:
            decrypted_path.unlink(missing_ok=True)
            raise BackupValidationError(
                'Backup authentication failed (wrong key or altered file).',
            ) from exc
        except OSError:
            decrypted_path.unlink(missing_ok=True)
            raise


def validate_zip_archive(archive_path):
    with zipfile.ZipFile(archive_path, 'r') as archive:
        members = archive.infolist()
        max_members = max(1, int(os.environ.get('BACKUP_MAX_MEMBERS', '100000')))
        max_uncompressed = max(
            1024 * 1024,
            int(os.environ.get('BACKUP_MAX_UNCOMPRESSED_BYTES', str(20 * 1024**3))),
        )
        max_ratio = max(10, int(os.environ.get('BACKUP_MAX_COMPRESSION_RATIO', '1000')))
        if len(members) > max_members:
            raise BackupValidationError('Backup contains too many files.')
        names = {member.filename for member in members}
        if len(names) != len(members):
            raise BackupValidationError('Backup contains duplicate file names.')
        if 'manifest.json' not in names:
            raise BackupValidationError('Backup manifest is missing.')
        total_uncompressed = 0
        for member in members:
            name = member.filename
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts:
                raise BackupValidationError(f'Unsafe archive path: {name}')
            unix_mode = (member.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(unix_mode):
                raise BackupValidationError(f'Symbolic links are not allowed: {name}')
            total_uncompressed += member.file_size
            if total_uncompressed > max_uncompressed:
                raise BackupValidationError('Backup is too large when decompressed.')
            if (
                member.file_size > 1024 * 1024
                and member.file_size > max(1, member.compress_size) * max_ratio
            ):
                raise BackupValidationError(
                    f'Suspicious compression ratio for backup member: {name}',
                )
        try:
            manifest = json.loads(archive.read('manifest.json'))
        except (KeyError, ValueError, UnicodeDecodeError) as exc:
            raise BackupValidationError('Backup manifest is invalid.') from exc
        if manifest.get('format') != 1:
            raise BackupValidationError('Unsupported backup manifest version.')
        checksums = manifest.get('files_sha256')
        if not isinstance(checksums, dict) or not checksums:
            raise BackupValidationError('Backup checksums are missing.')
        expected_members = names - {'manifest.json'}
        if set(checksums) != expected_members:
            raise BackupValidationError(
                'Backup manifest does not cover every archived file.',
            )
        for name, expected in checksums.items():
            if name not in names:
                raise BackupValidationError(f'Backup member is missing: {name}')
            if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
                raise BackupValidationError(f'Invalid checksum in manifest: {name}')
            with archive.open(name, 'r') as stream:
                actual = _sha256_stream(stream)
            if actual != expected:
                raise BackupValidationError(f'Checksum mismatch: {name}')
        database_files = expected_members & {'database.sqlite3', 'database.json'}
        if len(database_files) != 1:
            raise BackupValidationError('Backup must contain exactly one database export.')
        return manifest
