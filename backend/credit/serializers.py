from decimal import Decimal

from rest_framework import serializers

from sales.serializers import SaleItemDetailSerializer

from .models import CreditPayment, CreditSale, Customer


class CustomerSerializer(serializers.ModelSerializer):
    open_credit_total = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = (
            'id', 'name', 'phone', 'note',
            'created_at', 'updated_at', 'open_credit_total',
        )
        read_only_fields = ('created_at', 'updated_at')

    def get_open_credit_total(self, obj):
        total = Decimal('0')
        for credit in obj.credit_sales.exclude(status=CreditSale.Status.PAID):
            total += credit.remaining_amount
        return float(total)


class CreditPaymentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source='created_by.username', read_only=True,
    )

    class Meta:
        model = CreditPayment
        fields = (
            'id', 'amount', 'note',
            'created_by', 'created_by_name', 'created_at',
        )
        read_only_fields = ('created_by', 'created_at')


class CreditSaleListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_phone = serializers.CharField(source='customer.phone', read_only=True)
    sale_total = serializers.DecimalField(
        source='sale.total_ttc', max_digits=10, decimal_places=2, read_only=True,
    )
    sale_date = serializers.DateTimeField(source='sale.created_at', read_only=True)
    remaining_amount = serializers.SerializerMethodField()
    status_display = serializers.CharField(
        source='get_status_display', read_only=True,
    )

    class Meta:
        model = CreditSale
        fields = (
            'id', 'sale', 'sale_date', 'sale_total',
            'customer', 'customer_name', 'customer_phone',
            'status', 'status_display',
            'paid_amount', 'remaining_amount',
            'created_at',
        )

    def get_remaining_amount(self, obj):
        return float(obj.remaining_amount)


class CreditSaleDetailSerializer(CreditSaleListSerializer):
    items = SaleItemDetailSerializer(source='sale.items', many=True, read_only=True)
    payments = CreditPaymentSerializer(many=True, read_only=True)
    sale_discount = serializers.DecimalField(
        source='sale.discount_amount', max_digits=10, decimal_places=2, read_only=True,
    )

    class Meta(CreditSaleListSerializer.Meta):
        fields = CreditSaleListSerializer.Meta.fields + (
            'items', 'payments', 'sale_discount',
        )
