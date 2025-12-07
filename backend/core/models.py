from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils.translation import gettext_lazy as _


class User(AbstractUser):
    """Utilisateur personnalisé avec rôles"""
    
    class Role(models.TextChoices):
        ADMIN = 'ADMIN', _('Administrateur')
        CASHIER = 'CASHIER', _('Vendeur')

    role = models.CharField(
        _('Role'),
        max_length=10,
        choices=Role.choices,
        default=Role.CASHIER
    )
    phone = models.CharField(_('Phone'), max_length=20, blank=True)
    avatar = models.ImageField(
        _('Avatar'),
        upload_to='avatars/',
        blank=True,
        null=True
    )
    
    # Permissions individuelles
    can_view_stock = models.BooleanField(_('Can view stock'), default=False)
    can_manage_stock = models.BooleanField(_('Can manage stock'), default=False)

    class Meta:
        verbose_name = _('User')
        verbose_name_plural = _('Users')

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
    
    @property
    def is_admin_role(self):
        """Vérifie si l'utilisateur est admin"""
        return self.role == self.Role.ADMIN
    
    @property
    def is_cashier_role(self):
        """Vérifie si l'utilisateur est vendeur"""
        return self.role == self.Role.CASHIER


class AppSettings(models.Model):
    """Paramètres globaux de l'application"""
    
    class Meta:
        verbose_name = _('App Settings')
        verbose_name_plural = _('App Settings')
    
    # Informations de la librairie
    store_name = models.CharField(
        _('Store Name'), 
        max_length=200, 
        default='Librairie Attaquaddoum'
    )
    store_address = models.TextField(_('Store Address'), blank=True)
    store_phone = models.CharField(_('Store Phone'), max_length=20, blank=True)
    store_email = models.EmailField(_('Store Email'), blank=True)
    store_logo = models.ImageField(
        _('Store Logo'),
        upload_to='settings/',
        blank=True,
        null=True
    )
    
    # Permissions Vendeurs
    cashier_can_view_stock = models.BooleanField(_('Cashier can view stock'), default=False)
    cashier_can_manage_stock = models.BooleanField(_('Cashier can manage stock'), default=False)
    
    # TVA par défaut
    default_tva = models.DecimalField(
        _('Default VAT (%)'),
        max_digits=5,
        decimal_places=2,
        default=20.00
    )
    
    # Devise
    currency = models.CharField(_('Currency'), max_length=10, default='MAD')
    currency_symbol = models.CharField(_('Currency Symbol'), max_length=5, default='DH')
    
    # Impression tickets
    print_header = models.TextField(_('Ticket Header'), blank=True)
    print_footer = models.TextField(_('Ticket Footer'), blank=True)
    
    updated_at = models.DateTimeField(auto_now=True)
    
    def save(self, *args, **kwargs):
        # S'assurer qu'il n'y a qu'une seule instance
        self.pk = 1
        super().save(*args, **kwargs)
    
    @classmethod
    def get_settings(cls):
        """Récupère ou crée les paramètres"""
        settings, _ = cls.objects.get_or_create(pk=1)
        return settings
    
    def __str__(self):
        return self.store_name
