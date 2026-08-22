from decimal import Decimal

from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from sales.models import SaleItem

from .models import CreditPayment, CreditSale, Customer


class CreditSaleItemSerializer(serializers.ModelSerializer):
    """Items d'une vente à crédit — N'EXPOSE PAS les prix d'achat.
    Le vendeur n'a pas à voir la marge en regardant un crédit."""
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)

    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_name', 'product_barcode', 'quantity',
            'unit_price_ht', 'total_price_ht', 'tva_rate',
        )


class CustomerSerializer(serializers.ModelSerializer):
    open_credit_total = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = (
            'id', 'name', 'phone', 'note',
            'created_at', 'updated_at', 'open_credit_total',
        )
        read_only_fields = ('created_at', 'updated_at')

    @extend_schema_field(serializers.FloatField)
    def get_open_credit_total(self, obj) -> float:
        total = Decimal('0')
        for credit in obj.credit_sales.exclude(status=CreditSale.Status.PAID):
            total += credit.remaining_amount
        return float(total)


class CreditPaymentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source='created_by.username', read_only=True, allow_null=True,
    )
    reversed_by_name = serializers.CharField(
        source='reversed_by.username', read_only=True, allow_null=True,
    )
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = CreditPayment
        fields = (
            'id', 'amount', 'note', 'operation_id', 'status', 'status_display',
            'created_by', 'created_by_name', 'created_at',
            'reversed_by', 'reversed_by_name', 'reversed_at',
            'reversal_reason', 'reversal_operation_id',
        )
        read_only_fields = fields


class CreditPaymentCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.01'),
    )
    note = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )
    operation_id = serializers.RegexField(
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        max_length=64,
        required=False,
        help_text=(
            'Obligatoire ici ou dans l’en-tête Idempotency-Key; '
            'réutiliser la même valeur uniquement pour rejouer la même opération.'
        ),
    )


class CreditPaymentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField(
        min_length=3,
        max_length=200,
        trim_whitespace=True,
    )
    operation_id = serializers.RegexField(
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        max_length=64,
        required=False,
        help_text=(
            'Obligatoire ici ou dans l’en-tête Idempotency-Key; '
            'réutiliser la même valeur uniquement pour rejouer la même contrepassation.'
        ),
    )


class CreditSaleListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.name', read_only=True)
    customer_phone = serializers.CharField(source='customer.phone', read_only=True)
    sale_total = serializers.DecimalField(
        source='sale.total_ttc', max_digits=10, decimal_places=2, read_only=True,
    )
    adjusted_total = serializers.DecimalField(
        max_digits=10, decimal_places=2, read_only=True,
    )
    sale_date = serializers.DateTimeField(source='sale.created_at', read_only=True)
    remaining_amount = serializers.SerializerMethodField()
    status_display = serializers.CharField(
        source='get_status_display', read_only=True,
    )

    class Meta:
        model = CreditSale
        fields = (
            'id', 'sale', 'sale_date', 'sale_total', 'adjusted_total',
            'customer', 'customer_name', 'customer_phone',
            'status', 'status_display',
            'paid_amount', 'remaining_amount',
            'created_at',
        )

    @extend_schema_field(serializers.FloatField)
    def get_remaining_amount(self, obj) -> float:
        return float(obj.remaining_amount)


class CreditSaleDetailSerializer(CreditSaleListSerializer):
    items = CreditSaleItemSerializer(source='sale.items', many=True, read_only=True)
    payments = CreditPaymentSerializer(many=True, read_only=True)
    sale_discount = serializers.DecimalField(
        source='sale.discount_amount', max_digits=10, decimal_places=2, read_only=True,
    )

    class Meta(CreditSaleListSerializer.Meta):
        fields = CreditSaleListSerializer.Meta.fields + (
            'items', 'payments', 'sale_discount',
        )
