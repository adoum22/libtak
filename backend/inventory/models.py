from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _


class Supplier(models.Model):
    """Fournisseur de produits"""
    name = models.CharField(_('Name'), max_length=200)
    contact_name = models.CharField(_('Contact Name'), max_length=100, blank=True)
    email = models.EmailField(_('Email'), blank=True)
    phone = models.CharField(_('Phone'), max_length=20, blank=True)
    address = models.TextField(_('Address'), blank=True)
    notes = models.TextField(_('Notes'), blank=True)
    active = models.BooleanField(_('Active'), default=True)
    image = models.ImageField(_('Image'), upload_to='suppliers/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Supplier')
        verbose_name_plural = _('Suppliers')
        ordering = ['name']

    def __str__(self):
        return self.name


class Category(models.Model):
    """Catégorie de produits"""
    name = models.CharField(_('Name'), max_length=100)
    description = models.TextField(_('Description'), blank=True)
    icon = models.CharField(_('Icon'), max_length=50, blank=True, help_text="Lucide icon name")
    color = models.CharField(_('Color'), max_length=7, blank=True, help_text="Hex color code")

    class Meta:
        verbose_name = _('Category')
        verbose_name_plural = _('Categories')
        ordering = ['name']

    def __str__(self):
        return self.name


class Product(models.Model):
    """Produit avec prix d'achat et de vente"""
    name = models.CharField(_('Name'), max_length=200)
    barcode = models.CharField(_('Barcode'), max_length=50, unique=True, db_index=True)
    description = models.TextField(_('Description'), blank=True)
    
    # Prix
    purchase_price = models.DecimalField(
        _('Purchase Price'), 
        max_digits=10, 
        decimal_places=2,
        default=0,
        help_text=_('Cost price from supplier')
    )
    sale_price_ht = models.DecimalField(
        _('Sale Price HT'), 
        max_digits=10, 
        decimal_places=2,
        help_text=_('Selling price before tax')
    )
    tva = models.DecimalField(
        _('VAT (%)'), 
        max_digits=5, 
        decimal_places=2, 
        default=20.00
    )
    
    # Stock
    stock = models.IntegerField(_('Stock'), default=0)
    min_stock = models.IntegerField(_('Min Stock'), default=5)
    
    # Relations
    category = models.ForeignKey(
        Category, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='products'
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='products',
        verbose_name=_('Supplier')
    )
    
    # Image
    image = models.ImageField(
        _('Image'),
        upload_to='products/',
        blank=True,
        null=True
    )
    
    # Status
    active = models.BooleanField(_('Active'), default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Product')
        verbose_name_plural = _('Products')
        ordering = ['name']
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['barcode']),
        ]

    def __str__(self):
        return f"{self.name} ({self.barcode})"

    @property
    def price_ttc(self):
        """Prix de vente TTC"""
        return self.sale_price_ht * (1 + self.tva / 100)
    
    @property
    def profit_margin(self):
        """Marge bénéficiaire par unité"""
        return self.sale_price_ht - self.purchase_price
    
    @property
    def profit_percentage(self):
        """Pourcentage de marge"""
        if self.purchase_price > 0:
            return ((self.sale_price_ht - self.purchase_price) / self.purchase_price) * 100
        return 0
    
    @property
    def stock_value(self):
        """Valeur du stock au prix d'achat"""
        return self.stock * self.purchase_price
    
    @property
    def is_low_stock(self):
        """Vérifie si le stock est bas"""
        return self.stock <= self.min_stock


class StockMovement(models.Model):
    """Historique des mouvements de stock"""
    class MovementType(models.TextChoices):
        IN = 'IN', _('Stock In')           # Entrée (achat/réapprovisionnement)
        OUT = 'OUT', _('Stock Out')        # Sortie (vente)
        ADJUST = 'ADJUST', _('Adjustment') # Ajustement manuel
        RETURN = 'RETURN', _('Return')     # Retour client
    
    product = models.ForeignKey(
        Product, 
        on_delete=models.CASCADE,
        related_name='movements'
    )
    movement_type = models.CharField(
        _('Movement Type'),
        max_length=10, 
        choices=MovementType.choices
    )
    quantity = models.IntegerField(_('Quantity'))
    unit_cost = models.DecimalField(
        _('Unit Cost'),
        max_digits=10, 
        decimal_places=2, 
        null=True,
        blank=True,
        help_text=_('Cost per unit for stock in')
    )
    stock_before = models.IntegerField(_('Stock Before'))
    stock_after = models.IntegerField(_('Stock After'))
    reference = models.CharField(
        _('Reference'),
        max_length=100, 
        blank=True,
        help_text=_('Invoice number, sale ID, etc.')
    )
    notes = models.TextField(_('Notes'), blank=True)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name=_('Supplier')
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.SET_NULL, 
        null=True,
        verbose_name=_('Created By')
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Stock Movement')
        verbose_name_plural = _('Stock Movements')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.get_movement_type_display()} - {self.product.name} ({self.quantity})"

    def save(self, *args, **kwargs):
        """Mise à jour automatique du stock produit"""
        if not self.pk:  # Nouveau mouvement
            self.stock_before = self.product.stock
            
            if self.movement_type == self.MovementType.IN:
                self.product.stock += self.quantity
            elif self.movement_type == self.MovementType.OUT:
                self.product.stock -= self.quantity
            elif self.movement_type == self.MovementType.RETURN:
                self.product.stock += self.quantity
            elif self.movement_type == self.MovementType.ADJUST:
                # Pour adjustment, quantity est la nouvelle valeur absolue
                self.product.stock = self.quantity
                self.quantity = self.quantity - self.stock_before
            
            self.stock_after = self.product.stock
            self.product.save()
        
        super().save(*args, **kwargs)
