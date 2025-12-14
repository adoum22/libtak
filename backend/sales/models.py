from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from inventory.models import Product

class Sale(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = 'CASH', _('Cash')
        CARD = 'CARD', _('Card')
        OTHER = 'OTHER', _('Other')

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    total_ht = models.DecimalField(_('Total HT'), max_digits=10, decimal_places=2)
    total_tva = models.DecimalField(_('Total VAT'), max_digits=10, decimal_places=2)
    total_ttc = models.DecimalField(_('Total TTC'), max_digits=10, decimal_places=2)
    payment_method = models.CharField(max_length=10, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    synced = models.BooleanField(_('Synced to cloud'), default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Sale #{self.id} - {self.total_ttc} €"

class SaleItem(models.Model):
    sale = models.ForeignKey(Sale, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True)
    product_name = models.CharField(max_length=200) # Snapshot in case product is deleted
    quantity = models.IntegerField(default=1)
    unit_price_ht = models.DecimalField(max_digits=10, decimal_places=2)
    total_price_ht = models.DecimalField(max_digits=10, decimal_places=2)
    tva_rate = models.DecimalField(max_digits=5, decimal_places=2)

    def __str__(self):
        return f"{self.quantity}x {self.product_name}"


class Discount(models.Model):
    """Remises et promotions"""
    class DiscountType(models.TextChoices):
        PERCENTAGE = 'PERCENTAGE', _('Percentage')
        FIXED = 'FIXED', _('Fixed Amount')
    
    name = models.CharField(_('Name'), max_length=100)
    code = models.CharField(_('Code'), max_length=50, unique=True, blank=True, null=True)
    discount_type = models.CharField(
        _('Type'),
        max_length=20,
        choices=DiscountType.choices,
        default=DiscountType.PERCENTAGE
    )
    value = models.DecimalField(_('Value'), max_digits=10, decimal_places=2)
    min_purchase = models.DecimalField(
        _('Minimum Purchase'),
        max_digits=10,
        decimal_places=2,
        default=0,
        help_text=_('Minimum purchase amount to apply discount')
    )
    max_uses = models.IntegerField(_('Max Uses'), default=0, help_text=_('0 = unlimited'))
    uses_count = models.IntegerField(_('Uses Count'), default=0)
    active = models.BooleanField(_('Active'), default=True)
    start_date = models.DateField(_('Start Date'), null=True, blank=True)
    end_date = models.DateField(_('End Date'), null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Discount')
        verbose_name_plural = _('Discounts')
        ordering = ['-created_at']

    def __str__(self):
        if self.discount_type == self.DiscountType.PERCENTAGE:
            return f"{self.name} (-{self.value}%)"
        return f"{self.name} (-{self.value} DH)"
    
    @property
    def is_valid(self):
        """Check if discount is currently valid"""
        from django.utils import timezone
        today = timezone.now().date()
        
        if not self.active:
            return False
        if self.max_uses > 0 and self.uses_count >= self.max_uses:
            return False
        if self.start_date and today < self.start_date:
            return False
        if self.end_date and today > self.end_date:
            return False
        return True
    
    def calculate_discount(self, subtotal):
        """Calculate discount amount for a given subtotal"""
        if subtotal < self.min_purchase:
            return 0
        
        if self.discount_type == self.DiscountType.PERCENTAGE:
            return subtotal * (self.value / 100)
        else:
            return min(self.value, subtotal)  # Can't discount more than subtotal


class Return(models.Model):
    """Retours de produits"""
    class ReturnStatus(models.TextChoices):
        PENDING = 'PENDING', _('Pending')
        APPROVED = 'APPROVED', _('Approved')
        REJECTED = 'REJECTED', _('Rejected')
        COMPLETED = 'COMPLETED', _('Completed')
    
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name='returns')
    status = models.CharField(
        _('Status'),
        max_length=20,
        choices=ReturnStatus.choices,
        default=ReturnStatus.PENDING
    )
    reason = models.TextField(_('Reason'))
    refund_amount = models.DecimalField(_('Refund Amount'), max_digits=10, decimal_places=2, default=0)
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='processed_returns'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    synced = models.BooleanField(_('Synced to cloud'), default=False)

    class Meta:
        verbose_name = _('Return')
        verbose_name_plural = _('Returns')
        ordering = ['-created_at']

    def __str__(self):
        return f"Return #{self.id} for Sale #{self.sale_id}"


class ReturnItem(models.Model):
    """Articles retournés"""
    return_order = models.ForeignKey(Return, on_delete=models.CASCADE, related_name='items')
    sale_item = models.ForeignKey(SaleItem, on_delete=models.CASCADE)
    quantity = models.IntegerField(_('Quantity'), default=1)
    
    class Meta:
        verbose_name = _('Return Item')
        verbose_name_plural = _('Return Items')

    def __str__(self):
        return f"{self.quantity}x {self.sale_item.product_name}"

