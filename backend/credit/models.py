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
        indexes = [models.Index(fields=['name'], name='credit_cust_name_idx')]

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
        indexes = [
            models.Index(
                fields=['status', '-created_at'], name='credit_cs_status_idx',
            ),
        ]

    def __str__(self):
        return f"Crédit #{self.id} - {self.customer.name}"

    def _completed_return_totals(self):
        cached_returns = getattr(
            self.sale, '_prefetched_objects_cache', {},
        ).get('returns')
        if cached_returns is not None:
            completed = [
                return_order for return_order in cached_returns
                if return_order.status == 'COMPLETED'
            ]
            return {
                'returned': sum(
                    (row.refund_amount for row in completed),
                    Decimal('0.00'),
                ),
                'cash_refunded': sum(
                    (row.cash_refund_amount for row in completed),
                    Decimal('0.00'),
                ),
            }
        totals = self.sale.returns.filter(status='COMPLETED').aggregate(
            returned=models.Sum('refund_amount'),
            cash_refunded=models.Sum('cash_refund_amount'),
        )
        return {
            'returned': totals['returned'] or Decimal('0.00'),
            'cash_refunded': totals['cash_refunded'] or Decimal('0.00'),
        }

    @property
    def adjusted_total(self):
        """Principal restant après les retours crédit effectivement finalisés."""
        returned_amount = self._completed_return_totals()['returned']
        return max(
            (self.sale.total_ttc or Decimal('0.00')) - returned_amount,
            Decimal('0.00'),
        )

    def ledger_totals(self):
        """Retourne les montants dérivés de l'historique immuable."""
        gross_paid = (
            self.payments.filter(status='ACTIVE').aggregate(
                total=models.Sum('amount'),
            )['total']
            or Decimal('0.00')
        )
        return_totals = self._completed_return_totals()
        returned = return_totals['returned']
        cash_refunded = return_totals['cash_refunded']
        adjusted_total = max(
            (self.sale.total_ttc or Decimal('0.00')) - returned,
            Decimal('0.00'),
        )
        return {
            'gross_paid': gross_paid,
            'cash_refunded': cash_refunded,
            'net_paid': gross_paid - cash_refunded,
            'returned': returned,
            'adjusted_total': adjusted_total,
        }

    def synchronize_from_ledger(self):
        """Réconcilie le cache ``paid_amount/status`` depuis paiements+retours."""
        totals = self.ledger_totals()
        if totals['net_paid'] < 0:
            raise ValueError(
                'Les remboursements crédit dépassent les règlements actifs.'
            )
        if totals['adjusted_total'] <= 0:
            credit_status = self.Status.PAID
        elif totals['net_paid'] <= 0:
            credit_status = self.Status.UNPAID
        elif totals['net_paid'] >= totals['adjusted_total']:
            credit_status = self.Status.PAID
        else:
            credit_status = self.Status.PARTIAL
        if (
            self.paid_amount != totals['net_paid']
            or self.status != credit_status
        ):
            self.paid_amount = totals['net_paid']
            self.status = credit_status
            self.save(update_fields=['paid_amount', 'status', 'updated_at'])
        return totals

    @property
    def remaining_amount(self):
        return max(
            self.adjusted_total - (self.paid_amount or Decimal('0.00')),
            Decimal('0.00'),
        )


class CreditPayment(models.Model):
    """Écriture immuable de règlement client, annulable par contrepassation."""

    class PaymentStatus(models.TextChoices):
        ACTIVE = 'ACTIVE', _('Actif')
        REVERSED = 'REVERSED', _('Contrepassé')

    credit_sale = models.ForeignKey(
        CreditSale, on_delete=models.CASCADE, related_name='payments',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
        related_name='credit_payments_created',
    )
    operation_id = models.CharField(
        _('Idempotency Key'),
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    operation_payload_hash = models.CharField(
        max_length=64,
        blank=True,
        editable=False,
    )
    status = models.CharField(
        max_length=10,
        choices=PaymentStatus.choices,
        default=PaymentStatus.ACTIVE,
    )
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_payments_reversed',
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_reason = models.CharField(max_length=200, blank=True)
    reversal_operation_id = models.CharField(
        _('Reversal Idempotency Key'),
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    reversal_payload_hash = models.CharField(
        max_length=64,
        blank=True,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at'], name='credit_pay_created_idx'),
            models.Index(
                fields=['status', '-created_at'],
                name='credit_pay_status_idx',
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(amount__gt=0),
                name='credit_pay_amount_pos',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        operation_id__isnull=True,
                        operation_payload_hash='',
                    )
                    | (
                        models.Q(operation_id__isnull=False)
                        & ~models.Q(operation_payload_hash='')
                    )
                ),
                name='credit_pay_operation_meta',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        status='ACTIVE',
                        reversed_by__isnull=True,
                        reversed_at__isnull=True,
                        reversal_reason='',
                        reversal_operation_id__isnull=True,
                        reversal_payload_hash='',
                    )
                    | (
                        models.Q(
                            status='REVERSED',
                            reversed_at__isnull=False,
                            reversal_operation_id__isnull=False,
                        )
                        & ~models.Q(reversal_reason='')
                        & ~models.Q(reversal_payload_hash='')
                    )
                ),
                name='credit_pay_reversal_meta',
            ),
        ]

    def __str__(self):
        return f"Paiement #{self.id} - {self.amount}"
