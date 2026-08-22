"""Create or safely upgrade the private environment for a local install.

This helper is intentionally independent from Django so Windows launchers can
run it before the application imports its settings.  Existing non-empty values
are preserved: in particular, re-running it never rotates signing or backup
keys behind the operator's back.
"""

from __future__ import annotations

import base64
import os
import secrets
import sys
from pathlib import Path


STATIC_DEFAULTS = {
    'BACKUP_MIN_FREE_BYTES': str(256 * 1024**2),
    'BACKUP_RETENTION_DAYS': '30',
    'DEBUG': 'False',
    'ALLOWED_HOSTS': 'localhost,127.0.0.1',
    'CORS_ALLOWED_ORIGINS': (
        'http://localhost:5173,http://127.0.0.1:5173'
    ),
    'CSRF_TRUSTED_ORIGINS': (
        'http://localhost:5173,http://127.0.0.1:5173'
    ),
    # Local ASGI is deliberately bound to loopback and does not terminate TLS.
    'SECURE_SSL_REDIRECT': 'False',
    'IS_CLOUD_SERVER': 'False',
}


def _generated_defaults() -> dict[str, str]:
    return {
        'SECRET_KEY': secrets.token_urlsafe(50),
        'JWT_SIGNING_KEY': secrets.token_urlsafe(50),
        'BACKUP_ENCRYPTION_KEY': base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).decode('ascii'),
    }


def ensure_local_env(path: Path) -> None:
    """Fill missing/blank required settings and atomically persist ``path``."""
    path = Path(path)
    original = path.read_text(encoding='utf-8') if path.exists() else ''
    lines = original.splitlines()
    required = {**_generated_defaults(), **STATIC_DEFAULTS}
    populated: set[str] = set()

    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in line:
            continue
        raw_key, raw_value = line.split('=', 1)
        key = raw_key.strip()
        if key not in required:
            continue
        if raw_value.strip():
            populated.add(key)
        elif key not in populated:
            # An empty first definition wins in config.settings, so replace it
            # instead of appending a duplicate that would never be read.
            lines[index] = f'{key}={required[key]}'
            populated.add(key)

    for key, value in required.items():
        if key not in populated:
            lines.append(f'{key}={value}')

    payload = '\n'.join(lines) + '\n'
    if payload == original:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{secrets.token_hex(8)}.tmp')
    try:
        temporary.write_text(payload, encoding='utf-8')
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            # Windows ACLs, rather than POSIX modes, remain authoritative.
            pass
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.env')
    ensure_local_env(target)
