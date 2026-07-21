from rest_framework import serializers
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from .models import ReportSettings, ReportLog


class ReportSettingsSerializer(serializers.ModelSerializer):
    recipients_list = serializers.SerializerMethodField()

    class Meta:
        model = ReportSettings
        fields = [
            'email_recipients', 'recipients_list',
            'daily_enabled', 'daily_time',
            'weekly_enabled', 'weekly_time', 'weekly_day',
            'monthly_enabled', 'monthly_time',
            'quarterly_enabled', 'quarterly_time',
            'yearly_enabled', 'yearly_time',
            'daily_last_sent_on', 'weekly_last_sent_on',
            'monthly_last_sent_on', 'quarterly_last_sent_on',
            'yearly_last_sent_on', 'low_stock_last_sent_on',
            'backup_last_sent_on',
            'updated_at'
        ]
        read_only_fields = [
            'daily_last_sent_on', 'weekly_last_sent_on',
            'monthly_last_sent_on', 'quarterly_last_sent_on',
            'yearly_last_sent_on', 'low_stock_last_sent_on', 'updated_at',
            'backup_last_sent_on',
        ]

    def get_recipients_list(self, obj) -> list[str]:
        return obj.get_recipients_list()

    def validate_email_recipients(self, value):
        recipients = [item.strip() for item in value.split(',') if item.strip()]
        if len(recipients) > 25:
            raise serializers.ValidationError('Maximum 25 destinataires.')
        invalid = []
        for recipient in recipients:
            try:
                validate_email(recipient)
            except DjangoValidationError:
                invalid.append(recipient)
        if invalid:
            raise serializers.ValidationError(
                'Adresses invalides: ' + ', '.join(invalid),
            )
        return ', '.join(recipients)


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


class ReportItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    barcode = serializers.CharField(allow_blank=True)
    quantity = serializers.IntegerField()
    unit_price = serializers.FloatField()
    revenue = serializers.FloatField()
    cost = serializers.FloatField()
    profit = serializers.FloatField()


class ReportChartPointSerializer(serializers.Serializer):
    label = serializers.CharField()
    revenue = serializers.FloatField()
    count = serializers.IntegerField()


class ReportDataSerializer(serializers.Serializer):
    total_sales = serializers.IntegerField()
    total_revenue = serializers.FloatField()
    gross_revenue = serializers.FloatField(required=False)
    gross_margin = serializers.FloatField()
    operating_expenses = serializers.FloatField()
    total_profit = serializers.FloatField()
    returns_count = serializers.IntegerField(required=False)
    total_returns = serializers.FloatField(required=False)
    items_sold = ReportItemSerializer(many=True)
    chart_data = ReportChartPointSerializer(many=True)
    date = serializers.DateField(required=False)
    period_start = serializers.DateField(required=False)
    period_end = serializers.DateField(required=False)
    month = serializers.IntegerField(required=False)
    year = serializers.IntegerField(required=False)
