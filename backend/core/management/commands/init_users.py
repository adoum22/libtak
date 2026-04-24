import os
import secrets
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

from core.models import AppSettings


class Command(BaseCommand):
    help = "First-time user setup. Refuses to run if any user already exists."

    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.exists():
            self.stderr.write("Users already exist - refusing to run.")
            return

        admin_pwd = os.environ.get('INIT_ADMIN_PASSWORD') or secrets.token_urlsafe(16)
        User.objects.create_superuser(
            username='admin',
            email='admin@librairie.local',
            password=admin_pwd,
            role='ADMIN',
            first_name='Admin',
            last_name='Principal',
        )

        settings_obj = AppSettings.get_settings()
        if not settings_obj.store_name:
            settings_obj.store_name = "Librairie Attaquaddoum"
            settings_obj.currency = "MAD"
            settings_obj.currency_symbol = "DH"
            settings_obj.save()

        self.stdout.write(self.style.SUCCESS(
            f"Admin created. Username: admin  Password: {admin_pwd}"
        ))
        self.stdout.write(self.style.WARNING(
            "Save this password now - it will not be shown again."
        ))
