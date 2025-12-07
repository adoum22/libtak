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
