from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils.translation import gettext_lazy as _


class ExpenseCategory(models.Model):
    """Catégories de dépenses (Vendeuse, Internet, Électricité, etc.)"""

    name = models.CharField(_('Name'), max_length=100, unique=True)
    is_default = models.BooleanField(
        _('Default Category'),
        default=False,
        help_text=_('Catégorie par défaut, non supprimable'),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Expense Category')
        verbose_name_plural = _('Expense Categories')
        ordering = ['name']

    def __str__(self):
        return self.name


class MonthlyAccounting(models.Model):
    """Données comptables saisies par l'admin pour un mois donné."""

    year = models.IntegerField(
        _('Year'),
        validators=[MinValueValidator(2000), MaxValueValidator(2100)],
    )
    month = models.IntegerField(
        _('Month'),
        validators=[MinValueValidator(1), MaxValueValidator(12)],
    )
    manager_withdrawal = models.DecimalField(
        _('Manager Withdrawal'),
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text=_('Montant prélevé par le gérant (salaire/retrait)'),
    )
    notes = models.TextField(_('Notes'), blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _('Monthly Accounting')
        verbose_name_plural = _('Monthly Accounting')
        unique_together = [('year', 'month')]
        ordering = ['-year', '-month']
        indexes = [models.Index(fields=['year', 'month'])]

    def __str__(self):
        return f"{self.year}-{self.month:02d}"

    @property
    def quarter(self):
        return (self.month - 1) // 3 + 1


class Expense(models.Model):
    """Une dépense rattachée à un mois et une catégorie."""

    monthly = models.ForeignKey(
        MonthlyAccounting,
        on_delete=models.CASCADE,
        related_name='expenses',
        verbose_name=_('Monthly Accounting'),
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.PROTECT,
        related_name='expenses',
        verbose_name=_('Category'),
    )
    amount = models.DecimalField(
        _('Amount'),
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(0)],
    )
    description = models.CharField(_('Description'), max_length=255, blank=True)
    incurred_on = models.DateField(_('Incurred On'), null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _('Expense')
        verbose_name_plural = _('Expenses')
        ordering = ['-incurred_on', '-created_at']
        indexes = [models.Index(fields=['monthly', 'category'])]

    def __str__(self):
        return f"{self.category.name}: {self.amount}"
