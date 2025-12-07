from django.db import models
from django.utils.translation import gettext_lazy as _


class ReportSettings(models.Model):
    """Configuration des rapports automatiques"""
    
    class Meta:
        verbose_name = _('Report Settings')
        verbose_name_plural = _('Report Settings')
    
    # Destinataires
    email_recipients = models.TextField(
        _('Email Recipients'),
        help_text=_('Emails séparés par des virgules'),
        blank=True
    )
    
    # Configuration SMTP Expéditeur
    sender_email = models.EmailField(_('Sender Email'), blank=True, help_text=_('Email utilisé pour l\'envoi'))
    sender_password = models.CharField(_('Sender Password'), max_length=255, blank=True, help_text=_('Mot de passe d\'application ou SMTP'))
    smtp_host = models.CharField(_('SMTP Host'), max_length=255, default='smtp.gmail.com', blank=True)
    smtp_port = models.IntegerField(_('SMTP Port'), default=587)
    
    # Rapport Journalier
    daily_enabled = models.BooleanField(_('Daily Report Enabled'), default=True)
    daily_time = models.TimeField(_('Daily Report Time'), default='23:00')
    
    # Rapport Hebdomadaire
    weekly_enabled = models.BooleanField(_('Weekly Report Enabled'), default=True)
    weekly_time = models.TimeField(_('Weekly Report Time'), default='23:30')
    weekly_day = models.IntegerField(
        _('Weekly Report Day'),
        default=6,  # 0=Lundi, 6=Dimanche
        choices=[
            (0, _('Monday')),
            (1, _('Tuesday')),
            (2, _('Wednesday')),
            (3, _('Thursday')),
            (4, _('Friday')),
            (5, _('Saturday')),
            (6, _('Sunday')),
        ]
    )
    
    # Rapport Mensuel
    monthly_enabled = models.BooleanField(_('Monthly Report Enabled'), default=True)
    monthly_time = models.TimeField(_('Monthly Report Time'), default='23:45')
    
    # Rapport Trimestriel
    quarterly_enabled = models.BooleanField(_('Quarterly Report Enabled'), default=True)
    quarterly_time = models.TimeField(_('Quarterly Report Time'), default='23:50')
    
    # Rapport Annuel
    yearly_enabled = models.BooleanField(_('Yearly Report Enabled'), default=True)
    yearly_time = models.TimeField(_('Yearly Report Time'), default='23:55')
    
    updated_at = models.DateTimeField(auto_now=True)
    
    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)
    
    @classmethod
    def get_settings(cls):
        settings, _ = cls.objects.get_or_create(pk=1)
        return settings
    
    def get_recipients_list(self):
        """Retourne la liste des emails"""
        if not self.email_recipients:
            return []
        return [email.strip() for email in self.email_recipients.split(',') if email.strip()]
    
    def __str__(self):
        return "Report Settings"


class ReportLog(models.Model):
    """Historique des rapports envoyés"""
    
    class ReportType(models.TextChoices):
        DAILY = 'DAILY', _('Daily')
        WEEKLY = 'WEEKLY', _('Weekly')
        MONTHLY = 'MONTHLY', _('Monthly')
        QUARTERLY = 'QUARTERLY', _('Quarterly')
        YEARLY = 'YEARLY', _('Yearly')
    
    report_type = models.CharField(
        _('Report Type'),
        max_length=20,
        choices=ReportType.choices
    )
    period_start = models.DateField(_('Period Start'))
    period_end = models.DateField(_('Period End'))
    
    # Données du rapport
    total_sales = models.IntegerField(_('Total Sales'), default=0)
    total_revenue = models.DecimalField(
        _('Total Revenue'),
        max_digits=12,
        decimal_places=2,
        default=0
    )
    total_profit = models.DecimalField(
        _('Total Profit'),
        max_digits=12,
        decimal_places=2,
        default=0
    )
    items_sold = models.JSONField(_('Items Sold'), default=dict)
    
    # Envoi
    recipients = models.TextField(_('Recipients'))
    sent_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(_('Success'), default=True)
    error_message = models.TextField(_('Error Message'), blank=True)
    
    class Meta:
        verbose_name = _('Report Log')
        verbose_name_plural = _('Report Logs')
        ordering = ['-sent_at']
    
    def __str__(self):
        return f"{self.get_report_type_display()} - {self.period_start} to {self.period_end}"
