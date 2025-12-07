from django.contrib import admin
from .models import ReportSettings, ReportLog


@admin.register(ReportSettings)
class ReportSettingsAdmin(admin.ModelAdmin):
    list_display = ('email_recipients', 'daily_enabled', 'weekly_enabled', 'monthly_enabled', 'updated_at')
    
    fieldsets = (
        ('Destinataires', {
            'fields': ('email_recipients',)
        }),
        ('Rapport Journalier', {
            'fields': ('daily_enabled', 'daily_time')
        }),
        ('Rapport Hebdomadaire', {
            'fields': ('weekly_enabled', 'weekly_time', 'weekly_day')
        }),
        ('Rapport Mensuel', {
            'fields': ('monthly_enabled', 'monthly_time')
        }),
        ('Rapport Trimestriel', {
            'fields': ('quarterly_enabled', 'quarterly_time')
        }),
        ('Rapport Annuel', {
            'fields': ('yearly_enabled', 'yearly_time')
        }),
    )
    
    def has_add_permission(self, request):
        return not ReportSettings.objects.exists()
    
    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ReportLog)
class ReportLogAdmin(admin.ModelAdmin):
    list_display = ('report_type', 'period_start', 'period_end', 'total_sales', 'total_revenue', 'total_profit', 'success', 'sent_at')
    list_filter = ('report_type', 'success', 'sent_at')
    ordering = ('-sent_at',)
    readonly_fields = (
        'report_type', 'period_start', 'period_end',
        'total_sales', 'total_revenue', 'total_profit', 'items_sold',
        'recipients', 'sent_at', 'success', 'error_message'
    )
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
