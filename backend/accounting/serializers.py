from rest_framework import serializers
from .models import ExpenseCategory, MonthlyAccounting, Expense


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = ['id', 'name', 'is_default', 'created_at']
        read_only_fields = ['is_default', 'created_at']


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    year = serializers.IntegerField(write_only=True, required=False)
    month = serializers.IntegerField(write_only=True, required=False)

    class Meta:
        model = Expense
        fields = [
            'id', 'monthly', 'category', 'category_name',
            'amount', 'description', 'incurred_on',
            'year', 'month', 'created_at',
        ]
        read_only_fields = ['created_at', 'category_name']
        extra_kwargs = {'monthly': {'required': False}}

    def validate(self, attrs):
        # Allow creation by (year, month) instead of monthly id
        year = attrs.pop('year', None)
        month = attrs.pop('month', None)
        if not attrs.get('monthly'):
            if year is None or month is None:
                raise serializers.ValidationError(
                    "Provide either 'monthly' or both 'year' and 'month'."
                )
            monthly, _ = MonthlyAccounting.objects.get_or_create(
                year=year, month=month
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

    def get_total_expenses(self, obj):
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
