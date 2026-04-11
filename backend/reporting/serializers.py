from rest_framework import serializers
from .models import ReportSettings, ReportLog


class ReportSettingsSerializer(serializers.ModelSerializer):
    recipients_list = serializers.SerializerMethodField()
    # S-11: sender_password is write-only (never returned by the API) and
    # deprecated — prefer the REPORT_SMTP_PASSWORD environment variable.
    # This field is kept for backward compatibility with existing deployments
    # that store the password in the DB; new deployments should use the env var.
    sender_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        style={'input_type': 'password'},
        help_text='Deprecated: use REPORT_SMTP_PASSWORD env var instead.'
    )

    class Meta:
        model = ReportSettings
        fields = [
            'email_recipients', 'recipients_list',
            'sender_email', 'sender_password', 'smtp_host', 'smtp_port',
            'daily_enabled', 'daily_time',
            'weekly_enabled', 'weekly_time', 'weekly_day',
            'monthly_enabled', 'monthly_time',
            'quarterly_enabled', 'quarterly_time',
            'yearly_enabled', 'yearly_time',
            'updated_at'
        ]
        read_only_fields = ['updated_at']
    
    def get_recipients_list(self, obj):
        return obj.get_recipients_list()


class ReportLogSerializer(serializers.ModelSerializer):
    report_type_display = serializers.CharField(
        source='get_report_type_display', 
        read_only=True
    )
    
    class Meta:
        model = ReportLog
        fields = [
            'id', 'report_type', 'report_type_display',
            'period_start', 'period_end',
            'total_sales', 'total_revenue', 'total_profit',
            'items_sold',
            'recipients', 'sent_at', 'success', 'error_message'
        ]
