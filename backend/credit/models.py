from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class Customer(models.Model):
    """Fiche client réutilisable pour les ventes à crédit."""
    name = models.CharField(_('Nom'), max_length=200)
    phone = models.CharField(_('Téléphone'), max_length=30, blank=True)
    note = models.CharField(_('Note'), max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        indexes = [models.Index(fields=['name'])]

    def __str__(self):
        return self.name


class CreditSale(models.Model):
    """Vente à crédit liée à une Sale existante et à un Customer.

    Le stock est déjà sorti via le flux Sale standard. Cette table tient
    le statut de règlement et le montant payé cumulé.
    """
    class Status(models.TextChoices):
        UNPAID = 'UNPAID', _('Non réglé')
        PARTIAL = 'PARTIAL', _('Partiellement réglé')
        PAID = 'PAID', _('Réglé')

    sale = models.OneToOneField(
        'sales.Sale', on_delete=models.CASCADE, related_name='credit',
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name='credit_sales',
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.UNPAID,
    )
    paid_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0'),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at'])]

    def __str__(self):
        return f"Crédit #{self.id} - {self.customer.name}"

    @property
    def remaining_amount(self):
        return (self.sale.total_ttc or Decimal('0')) - (self.paid_amount or Decimal('0'))


class CreditPayment(models.Model):
    """Versement effectué par le client sur un crédit."""
    credit_sale = models.ForeignKey(
        CreditSale, on_delete=models.CASCADE, related_name='payments',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['-created_at'])]

    def __str__(self):
        return f"Paiement #{self.id} - {self.amount}"
