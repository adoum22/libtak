from decimal import Decimal

from rest_framework import serializers
from .models import CashRegisterAdjustment, ExpenseCategory, MonthlyAccounting, Expense


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ['id', 'name', 'is_default', 'created_at']
        read_only_fields = ['is_default', 'created_at']


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    created_by_name = serializers.CharField(
        source='created_by.username',
        read_only=True,
        default=None,
    )
    year = serializers.IntegerField(
        write_only=True,
        required=False,
        min_value=2000,
        max_value=2100,
    )
    month = serializers.IntegerField(
        write_only=True,
        required=False,
        min_value=1,
        max_value=12,
    )
    operation_id = serializers.UUIDField(required=False, write_only=True)

    class Meta:
        model = Expense
        fields = [
            'id', 'monthly', 'category', 'category_name',
            'amount', 'description', 'incurred_on',
            'paid_from_cash', 'created_by_name',
            'year', 'month', 'operation_id', 'created_at',
        ]
        read_only_fields = ['created_at', 'category_name', 'created_by_name']
        extra_kwargs = {'monthly': {'required': False}}

    def validate(self, attrs):
        if self.instance is not None and 'operation_id' in attrs:
            raise serializers.ValidationError({
                'operation_id': "L'identifiant d'opération ne peut pas être modifié.",
            })
        # Allow creation by (year, month) instead of monthly id
        year = attrs.pop('year', None)
        month = attrs.pop('month', None)
        monthly = attrs.get(
            'monthly',
            getattr(self.instance, 'monthly', None),
        )
        if monthly and (year is not None or month is not None):
            if year is None or month is None:
                raise serializers.ValidationError(
                    "Fournissez soit 'monthly', soit les deux champs 'year' et 'month'."
                )
            if monthly.year != year or monthly.month != month:
                raise serializers.ValidationError(
                    "La periode monthly ne correspond pas a year/month."
                )

        if not monthly:
            if year is None or month is None:
                raise serializers.ValidationError(
                    "Provide either 'monthly' or both 'year' and 'month'."
                )

        incurred_on = attrs.get(
            'incurred_on',
            getattr(self.instance, 'incurred_on', None),
        )
        target_year = monthly.year if monthly else year
        target_month = monthly.month if monthly else month
        if incurred_on and (
            incurred_on.year != target_year or incurred_on.month != target_month
        ):
            raise serializers.ValidationError({
                'incurred_on': (
                    "La date de la depense doit appartenir au mois comptable choisi."
                ),
            })

        if 'monthly' not in attrs and self.instance is None:
            monthly, _ = MonthlyAccounting.objects.get_or_create(
                year=year,
                month=month,
            )
            attrs['monthly'] = monthly
        return attrs


class MonthlyAccountingSerializer(serializers.ModelSerializer):
    expenses = ExpenseSerializer(many=True, read_only=True)
    total_expenses = serializers.SerializerMethodField()
    quarter = serializers.IntegerField(read_only=True)

    class Meta:
        model = MonthlyAccounting
        fields = [
            'id', 'year', 'month', 'quarter',
            'manager_withdrawal', 'notes',
            'expenses', 'total_expenses',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_total_expenses(self, obj) -> float:
        return float(sum(e.amount for e in obj.expenses.all()))

    def validate(self, attrs):
        year = attrs.get('year', getattr(self.instance, 'year', None))
        month = attrs.get('month', getattr(self.instance, 'month', None))
        qs = MonthlyAccounting.objects.filter(year=year, month=month)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                f"Une entrée existe déjà pour {year}-{month:02d}."
            )
        return attrs


class CashRegisterAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = CashRegisterAdjustment
        fields = [
            'id', 'adjustment_type', 'amount', 'counted_amount',
            'note', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['created_by_name', 'created_at']


class CashRegisterOperationSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['set_opening', 'count'])
    opening_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False,
    )
    counted_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False,
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    operation_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        required_field = (
            'opening_amount' if attrs['action'] == 'set_opening' else 'counted_amount'
        )
        if required_field not in attrs:
            raise serializers.ValidationError({
                required_field: 'Ce montant est obligatoire pour cette action.',
            })
        return attrs


class CashRegisterSummarySerializer(serializers.Serializer):
    balance = serializers.FloatField()
    opening_amount = serializers.FloatField()
    cash_sales_total = serializers.FloatField()
    returns_total = serializers.FloatField()
    expenses_total = serializers.FloatField()
    supplier_payments_total = serializers.FloatField()
    adjustments_total = serializers.FloatField()
    last_adjustment = CashRegisterAdjustmentSerializer(allow_null=True)
    recent_adjustments = CashRegisterAdjustmentSerializer(many=True)


class CashierExpenseCreateSerializer(serializers.Serializer):
    category = serializers.IntegerField(min_value=1)
    amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal('0.01'),
    )
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    incurred_on = serializers.DateField(required=False)
    operation_id = serializers.UUIDField(required=False)


class ManagerWithdrawalCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal('0.01'),
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    incurred_on = serializers.DateField(required=False)
    operation_id = serializers.UUIDField(required=False)
