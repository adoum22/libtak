"""
Management command to initialize default users and app settings on first deploy.

Usage:
    python manage.py create_default_users
    python manage.py create_default_users --force   # reset passwords even if users exist

This replaces the former public GET /api/auth/init-users/ endpoint which was
accessible without authentication and created accounts with known passwords.
"""
import secrets
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from core.models import AppSettings


class Command(BaseCommand):
    help = "Create default admin/cashier users for first-time setup (run once after deploy)"

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Reset passwords on existing users (use with caution)',
        )

    def handle(self, *args, **options):
        User = get_user_model()
        force = options['force']

        # --- Admin user ---
        admin_created = False
        admin_password = None

        if not User.objects.filter(username='admin').exists():
            admin_password = secrets.token_urlsafe(16)
            User.objects.create_superuser(
                username='admin',
                email='admin@librairie.com',
                password=admin_password,
                role='ADMIN',
                first_name='Admin',
                last_name='Principal',
            )
            admin_created = True
            self.stdout.write(self.style.SUCCESS(f'[+] Admin user created'))
            self.stdout.write(self.style.WARNING(f'    Username : admin'))
            self.stdout.write(self.style.WARNING(f'    Password : {admin_password}'))
            self.stdout.write(self.style.WARNING(f'    >>> Save this password — it will not be shown again <<<'))
        elif force:
            admin_password = secrets.token_urlsafe(16)
            user = User.objects.get(username='admin')
            user.set_password(admin_password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'[~] Admin password reset'))
            self.stdout.write(self.style.WARNING(f'    Username : admin'))
            self.stdout.write(self.style.WARNING(f'    Password : {admin_password}'))
            self.stdout.write(self.style.WARNING(f'    >>> Save this password — it will not be shown again <<<'))
        else:
            self.stdout.write('[ ] Admin user already exists — skipped (use --force to reset password)')

        # --- Cashier user ---
        if not User.objects.filter(username='vendeur').exists():
            cashier_password = secrets.token_urlsafe(16)
            User.objects.create_user(
                username='vendeur',
                email='vendeur@librairie.com',
                password=cashier_password,
                role='CASHIER',
                first_name='Mohamed',
                last_name='Vendeur',
            )
            self.stdout.write(self.style.SUCCESS(f'[+] Cashier user created'))
            self.stdout.write(self.style.WARNING(f'    Username : vendeur'))
            self.stdout.write(self.style.WARNING(f'    Password : {cashier_password}'))
            self.stdout.write(self.style.WARNING(f'    >>> Save this password — it will not be shown again <<<'))
        elif force:
            cashier_password = secrets.token_urlsafe(16)
            user = User.objects.get(username='vendeur')
            user.set_password(cashier_password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'[~] Cashier password reset'))
            self.stdout.write(self.style.WARNING(f'    Username : vendeur'))
            self.stdout.write(self.style.WARNING(f'    Password : {cashier_password}'))
            self.stdout.write(self.style.WARNING(f'    >>> Save this password — it will not be shown again <<<'))
        else:
            self.stdout.write('[ ] Cashier user already exists — skipped (use --force to reset password)')

        # --- App settings ---
        try:
            settings = AppSettings.get_settings()
            settings.store_name = 'Librairie Attaquaddoum'
            settings.currency = 'MAD'
            settings.currency_symbol = 'DH'
            settings.save()
            self.stdout.write(self.style.SUCCESS('[+] App settings initialized'))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f'[!] Settings error: {e}'))

        self.stdout.write(self.style.SUCCESS('\nSetup complete.'))
