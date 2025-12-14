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


class AuditLog(models.Model):
    """Journal d'audit des actions utilisateurs"""
    class ActionType(models.TextChoices):
        CREATE = 'CREATE', _('Create')
        UPDATE = 'UPDATE', _('Update')
        DELETE = 'DELETE', _('Delete')
        LOGIN = 'LOGIN', _('Login')
        LOGOUT = 'LOGOUT', _('Logout')
        SALE = 'SALE', _('Sale')
        RETURN = 'RETURN', _('Return')
        STOCK_IN = 'STOCK_IN', _('Stock In')
        STOCK_OUT = 'STOCK_OUT', _('Stock Out')
        EXPORT = 'EXPORT', _('Export')
    
    user = models.ForeignKey(
        'User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='audit_logs',
        verbose_name=_('User')
    )
    action = models.CharField(
        _('Action'),
        max_length=20,
        choices=ActionType.choices
    )
    model_name = models.CharField(_('Model'), max_length=100)
    object_id = models.IntegerField(_('Object ID'), null=True, blank=True)
    object_repr = models.CharField(_('Object'), max_length=255, blank=True)
    changes = models.JSONField(_('Changes'), default=dict, blank=True)
    ip_address = models.GenericIPAddressField(_('IP Address'), null=True, blank=True)
    user_agent = models.CharField(_('User Agent'), max_length=500, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Audit Log')
        verbose_name_plural = _('Audit Logs')
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['user', 'timestamp']),
            models.Index(fields=['action', 'timestamp']),
            models.Index(fields=['model_name', 'timestamp']),
        ]

    def __str__(self):
        return f"{self.user} - {self.get_action_display()} - {self.model_name}"
    
    @classmethod
    def log(cls, user, action, model_name, object_id=None, object_repr='', changes=None, request=None):
        """Helper method to create audit log entries"""
        ip_address = None
        user_agent = ''
        
        if request:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            if x_forwarded_for:
                ip_address = x_forwarded_for.split(',')[0]
            else:
                ip_address = request.META.get('REMOTE_ADDR')
            user_agent = request.META.get('HTTP_USER_AGENT', '')[:500]
        
        return cls.objects.create(
            user=user,
            action=action,
            model_name=model_name,
            object_id=object_id,
            object_repr=object_repr,
            changes=changes or {},
            ip_address=ip_address,
            user_agent=user_agent
        )

