"""Idempotent, non-interactive production bootstrap.

The command never embeds or prints credentials.  A new administrator is only
created (or an unusable legacy administrator recovered) when the operator
provides ``BOOTSTRAP_ADMIN_USERNAME`` and ``BOOTSTRAP_ADMIN_PASSWORD``.
"""

import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError
from django.db import transaction

from core.models import AppSettings


User = get_user_model()


def _bootstrap_credentials():
    username = os.environ.get('BOOTSTRAP_ADMIN_USERNAME', '').strip()
    password = os.environ.get('BOOTSTRAP_ADMIN_PASSWORD', '')
    email = os.environ.get('BOOTSTRAP_ADMIN_EMAIL', '').strip()
    return username, password, email


@transaction.atomic
def bootstrap_admin():
    usable_admin = User.objects.select_for_update().filter(
        role=User.Role.ADMIN,
        is_active=True,
    ).exclude(password='').exclude(password__startswith='!').first()
    if usable_admin:
        print('Administrator bootstrap skipped: an active administrator exists.')
        return usable_admin, False

    username, password, email = _bootstrap_credentials()
    if not username or not password:
        raise RuntimeError(
            'No usable administrator exists. Set BOOTSTRAP_ADMIN_USERNAME and '
            'BOOTSTRAP_ADMIN_PASSWORD, then run create_users.py again.'
        )

    user = User.objects.select_for_update().filter(username=username).first()
    if user and user.role != User.Role.ADMIN:
        raise RuntimeError(
            'BOOTSTRAP_ADMIN_USERNAME belongs to a non-admin account; choose '
            'a different username.'
        )

    candidate = user or User(username=username, email=email, role=User.Role.ADMIN)
    if email:
        candidate.email = email
    try:
        password_validation.validate_password(password, user=candidate)
    except ValidationError as exc:
        raise RuntimeError(
            'BOOTSTRAP_ADMIN_PASSWORD does not satisfy the configured password policy: '
            + '; '.join(exc.messages)
        ) from exc

    created = user is None
    if created:
        user = User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            role=User.Role.ADMIN,
        )
    else:
        user.email = email or user.email
        user.is_active = True
        user.is_staff = True
        user.set_password(password)
        user.save(update_fields=['email', 'is_active', 'is_staff', 'password'])

    print('Administrator bootstrap completed without exposing credentials.')
    return user, created


def initialize_app_settings():
    _, created = AppSettings.objects.get_or_create(pk=1)
    print(
        'Application settings created.'
        if created
        else 'Application settings preserved.'
    )


def main():
    bootstrap_admin()
    initialize_app_settings()


if __name__ == '__main__':
    main()
