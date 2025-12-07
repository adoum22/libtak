import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from core.models import AppSettings

User = get_user_model()

def create_users():
    """Créer les utilisateurs de démo"""
    
    # Admin
    if not User.objects.filter(username='admin').exists():
        User.objects.create_superuser(
            username='admin',
            email='admin@librairie-attaquaddoum.com',
            password='admin123',
            role='ADMIN',
            first_name='Administrateur',
            last_name='Principal'
        )
        print("✓ Superuser 'admin' créé (admin / admin123)")
    else:
        print("- Superuser 'admin' existe déjà")
    
    # Vendeur
    if not User.objects.filter(username='vendeur').exists():
        User.objects.create_user(
            username='vendeur',
            email='vendeur@librairie-attaquaddoum.com',
            password='vendeur123',
            role='CASHIER',
            first_name='Mohamed',
            last_name='Vendeur'
        )
        print("✓ User 'vendeur' créé (vendeur / vendeur123)")
    else:
        print("- User 'vendeur' existe déjà")


def create_app_settings():
    """Créer les paramètres de l'application"""
    settings = AppSettings.get_settings()
    settings.store_name = "Librairie Attaquaddoum"
    settings.store_address = "Casablanca, Maroc"
    settings.currency = "MAD"
    settings.currency_symbol = "DH"
    settings.default_tva = 20.00
    settings.save()
    print("✓ Paramètres de l'application configurés")


if __name__ == '__main__':
    print("\n=== Création des utilisateurs ===")
    create_users()
    print("\n=== Configuration de l'application ===")
    create_app_settings()
    print("\n=== Terminé ===\n")
