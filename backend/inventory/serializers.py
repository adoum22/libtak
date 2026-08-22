from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from core.image_validators import validate_image_upload
from .models import (
    Category,
    InventoryCount,
    InventoryCountItem,
    Product,
    ProductCostLayer,
    PriceHistory,
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
    SupplierPayment,
    StockMovement,
)


class ProductPriceLayerReadSerializer(serializers.Serializer):
    remaining_quantity = serializers.IntegerField()
    sale_price = serializers.DecimalField(max_digits=10, decimal_places=2)


class ProductCostLayerReadSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    initial_quantity = serializers.IntegerField()
    remaining_quantity = serializers.IntegerField()
    unit_cost = serializers.DecimalField(max_digits=10, decimal_places=2)
    sale_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    created_at = serializers.DateTimeField()
    note = serializers.CharField()


class PurchaseOrderProductLayerReadSerializer(serializers.Serializer):
    initial_quantity = serializers.IntegerField()
    remaining_quantity = serializers.IntegerField()
    unit_cost = serializers.DecimalField(max_digits=10, decimal_places=2)
    sale_price = serializers.DecimalField(max_digits=10, decimal_places=2)
    created_at = serializers.DateTimeField()
    note = serializers.CharField()


class SupplierSerializer(serializers.ModelSerializer):
    products_count = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'contact_name', 'email', 'phone',
            'address', 'notes', 'active', 'products_count',
            'image', 'image_url',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    @extend_schema_field(serializers.IntegerField())
    def get_products_count(self, obj) -> int:
        return obj.products.count()

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_image_url(self, obj) -> str | None:
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None

    def validate_image(self, value):
        return validate_image_upload(value)

    def to_representation(self, instance):
        """Hide supplier contact details from non-administrator accounts."""
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated or not user.is_admin_role:
            for field in ('contact_name', 'email', 'phone', 'address', 'notes'):
                data.pop(field, None)
        return data


class CategorySerializer(serializers.ModelSerializer):
    products_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ['id', 'name', 'description', 'icon', 'color', 'products_count']

    @extend_schema_field(serializers.IntegerField())
    def get_products_count(self, obj) -> int:
        return obj.products.count()


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    price_ttc = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    profit_margin = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    # A valid margin can easily exceed 999.99% (for example a low-cost item).
    # Keep enough integer digits for the full range allowed by product prices.
    profit_percentage = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    stock_value = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)
    image_url = serializers.SerializerMethodField()
    price_layers = serializers.SerializerMethodField()
    cost_layers = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'barcode', 'description',
            'purchase_price', 'sale_price_ht', 'tva', 'price_ttc',
            'profit_margin', 'profit_percentage',
            'stock', 'min_stock', 'stock_value', 'is_low_stock',
            'price_layers', 'cost_layers',
            'category', 'category_name',
            'supplier', 'supplier_name',
            'image', 'image_url',
            'active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['stock', 'created_at', 'updated_at']

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_image_url(self, obj) -> str | None:
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None

    def validate_image(self, value):
        return validate_image_upload(value)

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if (
            user
            and user.is_authenticated
            and not user.is_admin_role
            and 'purchase_price' in attrs
        ):
            raise serializers.ValidationError({
                'purchase_price': "Le prix d'achat est réservé aux administrateurs."
            })
        for field in ('purchase_price', 'sale_price_ht'):
            if field in attrs and attrs[field] < 0:
                raise serializers.ValidationError({
                    field: 'La valeur doit être positive.'
                })
        if 'tva' in attrs and not Decimal('0') <= attrs['tva'] <= Decimal('100'):
            raise serializers.ValidationError({
                'tva': 'La TVA doit être comprise entre 0 et 100.'
            })
        if 'min_stock' in attrs and attrs['min_stock'] < 0:
            raise serializers.ValidationError({
                'min_stock': 'La valeur doit être positive.'
            })
        return attrs

    def to_representation(self, instance):
        """Enforce cost-data authorization at the API boundary."""
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated or not user.is_admin_role:
            for field in (
                'purchase_price',
                'profit_margin',
                'profit_percentage',
                'stock_value',
                'cost_layers',
            ):
                data.pop(field, None)
        return data

    @extend_schema_field(ProductPriceLayerReadSerializer(many=True))
    def get_price_layers(self, obj) -> list[dict]:
        return [
            {
                'remaining_quantity': layer.remaining_quantity,
                'sale_price': obj.sale_price_ht,
            }
            for layer in obj.cost_layers.filter(
                remaining_quantity__gt=0,
            ).order_by('created_at', 'id')
        ]

    @extend_schema_field(ProductCostLayerReadSerializer(many=True))
    def get_cost_layers(self, obj) -> list[dict]:
        return [
            {
                'id': layer.id,
                'initial_quantity': layer.initial_quantity,
                'remaining_quantity': layer.remaining_quantity,
                'unit_cost': layer.unit_cost,
                'sale_price': obj.sale_price_ht,
                'created_at': layer.created_at,
                'note': layer.note,
            }
            for layer in obj.cost_layers.filter(
                remaining_quantity__gt=0,
            ).order_by('created_at', 'id')[:10]
        ]


class ProductCostLayerSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)

    class Meta:
        model = ProductCostLayer
        fields = [
            'id', 'product', 'product_name', 'initial_quantity',
            'remaining_quantity', 'unit_cost', 'sale_price', 'note',
            'created_at',
        ]
        read_only_fields = [
            'id', 'product', 'product_name', 'initial_quantity',
            'remaining_quantity', 'created_at',
        ]
        extra_kwargs = {
            'unit_cost': {'min_value': Decimal('0')},
            'sale_price': {'min_value': Decimal('0')},
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Compatibilite API : le champ existe encore, mais il represente
        # desormais le prix courant unique du produit, jamais un tarif de lot.
        data['sale_price'] = str(instance.product.sale_price_ht)
        return data


class ProductCostLayerUpdateResponseSerializer(serializers.Serializer):
    layer = ProductCostLayerSerializer()
    product = ProductSerializer()


class ProductCreateSerializer(serializers.ModelSerializer):
    """Serializer pour la création de produit avec moins de champs requis"""
    class Meta:
        model = Product
        fields = [
            'id', 'name', 'barcode', 'description',
            'purchase_price', 'sale_price_ht', 'tva',
            'stock', 'min_stock',
            'category', 'supplier', 'image', 'active'
        ]

    def validate_barcode(self, value):
        if Product.objects.filter(barcode=value).exists():
            raise serializers.ValidationError("Un produit avec ce code-barres existe déjà.")
        return value

    def validate_image(self, value):
        return validate_image_upload(value)

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if (
            user
            and user.is_authenticated
            and not user.is_admin_role
            and 'purchase_price' in attrs
        ):
            raise serializers.ValidationError({
                'purchase_price': "Le prix d'achat est réservé aux administrateurs."
            })
        if (
            user
            and user.is_authenticated
            and not user.is_admin_role
            and attrs.get('stock', 0) > 0
        ):
            raise serializers.ValidationError({
                'stock': (
                    'Le stock initial doit être nul pour un vendeur. '
                    "Utilisez ensuite un flux d'entrée de stock traçable."
                )
            })
        for field in ('purchase_price', 'sale_price_ht', 'tva'):
            if attrs.get(field, Decimal('0')) < 0:
                raise serializers.ValidationError({field: 'La valeur doit être positive.'})
        if attrs.get('tva', Decimal('0')) > 100:
            raise serializers.ValidationError({
                'tva': 'La TVA doit être comprise entre 0 et 100.'
            })
        for field in ('stock', 'min_stock'):
            if attrs.get(field, 0) < 0:
                raise serializers.ValidationError({field: 'La valeur doit être positive.'})
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated or not user.is_admin_role:
            data.pop('purchase_price', None)
        return data

    @transaction.atomic
    def create(self, validated_data):
        """Crée le produit ET le 1er layer FIFO si du stock initial est saisi.

        Sans ça, un nouveau produit avec stock>0 saisi depuis l'UI n'a pas
        de layer : la 1re vente déclenche `ensure_layers_cover_stock` qui
        crée un layer au `purchase_price` *actuel* (qui peut avoir change
        entre la creation du produit et la 1re vente). Le snapshot serait
        alors faux. On fige donc le coût initial dès la creation.
        """
        initial_stock = validated_data.pop('stock', 0)
        product = super().create({**validated_data, 'stock': 0})
        if initial_stock > 0:
            request = self.context.get('request')
            user = getattr(request, 'user', None)
            StockMovement.objects.create(
                product=product,
                movement_type=StockMovement.MovementType.IN,
                quantity=initial_stock,
                unit_cost=product.purchase_price,
                sale_price=product.sale_price_ht,
                reference=f'PRODUCT-CREATE-{product.pk}',
                notes='Stock initial à la création du produit',
                created_by=(
                    user if user and user.is_authenticated else None
                ),
            )
            product.refresh_from_db()
        return product


class ProductImportRowSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    barcode = serializers.CharField(max_length=50)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    purchase_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0'), default=Decimal('0')
    )
    sale_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0'), default=Decimal('0')
    )
    tva = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=Decimal('0'),
        max_value=Decimal('100'),
        default=Decimal('0'),
    )
    stock = serializers.IntegerField(min_value=0, default=0)
    min_stock = serializers.IntegerField(min_value=0, default=5)
    category = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
        default='General',
    )
    supplier = serializers.CharField(
        max_length=200,
        required=False,
        allow_blank=True,
        default='',
    )
    image = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        default='',
    )


class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    movement_type_display = serializers.CharField(source='get_movement_type_display', read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            'id', 'product', 'product_name', 'product_barcode',
            'movement_type', 'movement_type_display',
            'quantity', 'unit_cost', 'sale_price',
            'stock_before', 'stock_after',
            'reference', 'notes',
            'supplier', 'supplier_name',
            'created_by', 'created_by_name',
            'created_at'
        ]
        read_only_fields = [
            'stock_before', 'stock_after',
            'created_by', 'created_at'
        ]
        extra_kwargs = {
            'unit_cost': {'min_value': Decimal('0')},
            'sale_price': {'min_value': Decimal('0')},
        }

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if (
            user
            and user.is_authenticated
            and not user.is_admin_role
            and 'unit_cost' in attrs
        ):
            raise serializers.ValidationError({
                'unit_cost': "Le coût unitaire est réservé aux administrateurs."
            })
        movement_type = attrs.get('movement_type')
        quantity = attrs.get('quantity')
        if movement_type == StockMovement.MovementType.ADJUST:
            if quantity is not None and quantity < 0:
                raise serializers.ValidationError({
                    'quantity': 'Le stock cible ne peut pas être négatif.'
                })
        elif quantity is not None and quantity <= 0:
            raise serializers.ValidationError({
                'quantity': 'La quantité doit être strictement positive.'
            })
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated or not user.is_admin_role:
            data.pop('unit_cost', None)
        return data

    def create(self, validated_data):
        validated_data['created_by'] = self.context['request'].user
        try:
            return super().create(validated_data)
        except DjangoValidationError as exc:
            detail = getattr(exc, 'message_dict', None) or {
                'detail': exc.messages
            }
            raise serializers.ValidationError(detail) from exc


class StockInSerializer(serializers.Serializer):
    """Serializer simplifié pour l'entrée de stock"""
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1, max_value=1_000_000)
    unit_cost = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0'), required=False
    )
    sale_price = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0'), required=False
    )
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), required=False)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(
        max_length=2000,
        required=False,
        allow_blank=True,
    )

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if (
            user
            and user.is_authenticated
            and not user.is_admin_role
            and 'unit_cost' in attrs
        ):
            raise serializers.ValidationError({
                'unit_cost': "Le coût unitaire est réservé aux administrateurs."
            })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        product = Product.objects.select_for_update().get(
            pk=validated_data['product'].pk,
        )

        # Si pas de coût unitaire fourni, utiliser le prix d'achat du produit
        unit_cost = validated_data.get('unit_cost', product.purchase_price)
        sale_price = validated_data.get('sale_price', product.sale_price_ht)
        if sale_price != product.sale_price_ht:
            old_sale_price = product.sale_price_ht
            product.sale_price_ht = sale_price
            product.save(update_fields=['sale_price_ht', 'updated_at'])
            PriceHistory.objects.create(
                product=product,
                old_purchase_price=product.purchase_price,
                new_purchase_price=product.purchase_price,
                old_sale_price=old_sale_price,
                new_sale_price=product.sale_price_ht,
                changed_by=self.context['request'].user,
                reason='Entree de stock avec nouveau prix de vente',
            )

        movement = StockMovement.objects.create(
            product=product,
            movement_type=StockMovement.MovementType.IN,
            quantity=validated_data['quantity'],
            unit_cost=unit_cost,
            sale_price=sale_price,
            supplier=validated_data.get('supplier'),
            reference=validated_data.get('reference', ''),
            notes=validated_data.get('notes', ''),
            created_by=self.context['request'].user
        )
        return movement


MAX_BULK_STOCK_ITEMS = 200


class BulkStockInSerializer(serializers.Serializer):
    """Validate and create a bounded stock-entry batch atomically."""

    items = StockInSerializer(
        many=True,
        allow_empty=False,
        max_length=MAX_BULK_STOCK_ITEMS,
    )

    @transaction.atomic
    def create(self, validated_data):
        child = self.fields['items'].child
        return [child.create(item) for item in validated_data['items']]


# ---- Purchase Order Serializers ----

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    current_sale_price = serializers.DecimalField(
        source='product.sale_price_ht',
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )
    product_layers = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrderItem
        fields = [
            'id', 'product', 'product_name', 'quantity', 'unit_cost',
            'sale_price', 'current_sale_price', 'received_quantity',
            'received_cost_total', 'product_layers',
        ]
        read_only_fields = ['received_quantity', 'received_cost_total']

    @extend_schema_field(PurchaseOrderProductLayerReadSerializer(many=True))
    def get_product_layers(self, obj) -> list[dict]:
        return [
            {
                'initial_quantity': layer.initial_quantity,
                'remaining_quantity': layer.remaining_quantity,
                'unit_cost': layer.unit_cost,
                'sale_price': obj.product.sale_price_ht,
                'created_at': layer.created_at,
                'note': layer.note,
            }
            for layer in obj.product.cost_layers.filter(
                remaining_quantity__gt=0,
            ).order_by('created_at', 'id')[:10]
        ]


class SupplierPaymentSerializer(serializers.ModelSerializer):
    method_display = serializers.CharField(source='get_method_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(
        source='created_by.username',
        read_only=True,
        allow_null=True,
    )
    reversed_by_name = serializers.CharField(
        source='reversed_by.username',
        read_only=True,
        allow_null=True,
    )

    class Meta:
        model = SupplierPayment
        fields = [
            'id', 'amount', 'method', 'method_display', 'paid_on',
            'reference', 'note', 'status', 'status_display',
            'created_by_name', 'created_at', 'reversed_by_name',
            'reversed_at', 'reversal_reason',
        ]
        read_only_fields = fields


class SupplierPaymentCreateSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal('0.01'),
    )
    method = serializers.ChoiceField(choices=SupplierPayment.PaymentMethod.choices)
    paid_on = serializers.DateField(required=False, default=timezone.localdate)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True)
    operation_id = serializers.RegexField(
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        max_length=64,
        required=False,
    )


class SupplierPaymentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, trim_whitespace=True)
    operation_id = serializers.RegexField(
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        max_length=64,
        required=False,
    )

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError(
                'Le motif de contrepassation est obligatoire.'
            )
        return value


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    payments = SupplierPaymentSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    total_amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    paid_amount = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()

    def _payment_summary(self, obj):
        cached = getattr(obj, '_serialized_payment_summary', None)
        if cached is not None:
            return cached
        total = obj.total_amount
        paid = sum(
            (
                payment.amount
                for payment in obj.payments.all()
                if payment.status == SupplierPayment.PaymentStatus.ACTIVE
            ),
            Decimal('0.00'),
        )
        balance = max(total - paid, Decimal('0.00'))
        payment_status = (
            'UNPAID' if paid <= 0
            else 'PAID' if paid >= total
            else 'PARTIAL'
        )
        cached = (paid, balance, payment_status)
        obj._serialized_payment_summary = cached
        return cached

    @extend_schema_field(serializers.DecimalField(max_digits=12, decimal_places=2))
    def get_paid_amount(self, obj):
        return self._payment_summary(obj)[0]

    @extend_schema_field(serializers.DecimalField(max_digits=12, decimal_places=2))
    def get_balance_due(self, obj):
        return self._payment_summary(obj)[1]

    @extend_schema_field(serializers.CharField())
    def get_payment_status(self, obj):
        return self._payment_summary(obj)[2]

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'reference', 'supplier', 'supplier_name',
            'status', 'status_display', 'notes', 'expected_date',
            'items', 'total_amount', 'payments', 'paid_amount',
            'balance_due', 'payment_status',
            'created_by', 'created_by_name', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'reference', 'status', 'created_by', 'created_at', 'updated_at',
            'total_amount', 'payments', 'paid_amount', 'balance_due',
            'payment_status',
        ]

    def create(self, validated_data):
        validated_data['created_by'] = self.context['request'].user
        return super().create(validated_data)


class PurchaseOrderWriteItemSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0'),
        required=False,
    )
    sale_price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0'),
        required=False,
        allow_null=True,
    )


class PurchaseOrderCreateSerializer(serializers.ModelSerializer):
    items = PurchaseOrderWriteItemSerializer(many=True, allow_empty=False, write_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'reference', 'status', 'supplier', 'notes',
            'expected_date', 'items',
        ]
        read_only_fields = ['id', 'reference', 'status']

    def validate_items(self, value):
        product_ids = [item['product'].pk for item in value]
        if len(product_ids) != len(set(product_ids)):
            raise serializers.ValidationError(
                'Un produit ne peut apparaître qu’une fois dans une commande.'
            )
        return value

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        validated_data['created_by'] = self.context['request'].user
        product_ids = sorted(item['product'].pk for item in items_data)
        products = {
            product.pk: product
            for product in Product.objects.select_for_update()
            .filter(pk__in=product_ids)
            .order_by('pk')
        }
        missing_products = sorted(set(product_ids) - set(products))
        if missing_products:
            raise serializers.ValidationError({
                'items': f'Produits indisponibles: {missing_products}.'
            })
        order = PurchaseOrder.objects.create(**validated_data)
        PurchaseOrderItem.objects.bulk_create([
            PurchaseOrderItem(
                order=order,
                product=products[item['product'].pk],
                quantity=item['quantity'],
                unit_cost=item.get(
                    'unit_cost',
                    products[item['product'].pk].purchase_price,
                ),
                sale_price=item.get('sale_price'),
            )
            for item in items_data
        ])
        return order


class PurchaseOrderReceiveItemSerializer(serializers.Serializer):
    item_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, required=False)
    unit_cost = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0'),
        required=False,
    )
    update_purchase_price = serializers.BooleanField(required=False, default=False)
    new_sale_price = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0'),
        required=False,
        allow_null=True,
    )
    update_sale_price = serializers.BooleanField(required=False, default=False)


class PurchaseOrderReceiveSerializer(serializers.Serializer):
    receipt_id = serializers.RegexField(
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        max_length=64,
        required=False,
    )
    items = PurchaseOrderReceiveItemSerializer(many=True, allow_empty=False)

    def validate_items(self, value):
        item_ids = [item['item_id'] for item in value]
        if len(item_ids) != len(set(item_ids)):
            raise serializers.ValidationError(
                'Une ligne de commande ne peut être réceptionnée qu’une fois par requête.'
            )
        return value


# ---- Inventory Count Serializers ----

class InventoryCountItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    difference = serializers.IntegerField(read_only=True)

    class Meta:
        model = InventoryCountItem
        fields = ['id', 'product', 'product_name', 'product_barcode',
                  'expected_quantity', 'counted_quantity', 'difference']


class InventoryCountSerializer(serializers.ModelSerializer):
    items = InventoryCountItemSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(source='counted_by.username', read_only=True)
    validated_by_name = serializers.CharField(
        source='validated_by.username', read_only=True
    )

    class Meta:
        model = InventoryCount
        fields = ['id', 'name', 'status', 'status_display', 'notes',
                  'items', 'counted_by', 'created_by_name',
                  'validated_by', 'validated_by_name',
                  'created_at', 'completed_at']
        read_only_fields = [
            'status', 'counted_by', 'validated_by', 'created_at', 'completed_at'
        ]

    def create(self, validated_data):
        validated_data['counted_by'] = self.context['request'].user
        return super().create(validated_data)


class InventoryCountCreateItemSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    expected_quantity = serializers.IntegerField(required=False, write_only=True)
    counted_quantity = serializers.IntegerField(
        min_value=0,
        required=False,
        allow_null=True,
    )


class InventoryCountUpdateItemSerializer(serializers.Serializer):
    id = serializers.IntegerField(min_value=1)
    counted_quantity = serializers.IntegerField(min_value=0)


class InventoryCountUpdateSerializer(serializers.Serializer):
    items = InventoryCountUpdateItemSerializer(many=True, allow_empty=False)

    def validate_items(self, value):
        item_ids = [item['id'] for item in value]
        if len(item_ids) != len(set(item_ids)):
            raise serializers.ValidationError('Une ligne est présente plusieurs fois.')
        return value


def validate_inventory_count(count, user):
    """Apply a completed physical count through absolute ADJUST movements."""
    with transaction.atomic():
        locked_count = InventoryCount.objects.select_for_update().get(pk=count.pk)
        if locked_count.status != InventoryCount.CountStatus.COMPLETED:
            raise serializers.ValidationError(
                {'detail': 'Le comptage doit être terminé avant validation.'}
            )

        items = list(
            InventoryCountItem.objects.select_for_update()
            .filter(count=locked_count)
            .select_related('product')
            .order_by('product_id')
        )
        missing = [item.id for item in items if item.counted_quantity is None]
        if missing:
            raise serializers.ValidationError({
                'items': f'Quantités comptées manquantes pour les lignes: {missing}.'
            })

        product_ids = [item.product_id for item in items]
        products = {
            product.pk: product
            for product in Product.objects.select_for_update()
            .filter(pk__in=product_ids)
            .order_by('pk')
        }
        adjustments = []
        for item in items:
            product = products[item.product_id]
            ProductCostLayer.reconcile_to_stock(product)
            before = product.stock
            snapshot_difference = (
                item.counted_quantity - item.expected_quantity
            )
            target = before + snapshot_difference
            if target < 0:
                raise serializers.ValidationError({
                    'items': (
                        f'Le décalage du produit {product.name} conduirait '
                        'à un stock négatif. Recommence le comptage.'
                    )
                })
            if snapshot_difference:
                movement = StockMovement.objects.create(
                    product=product,
                    movement_type=StockMovement.MovementType.ADJUST,
                    quantity=target,
                    notes=(
                        f'Ajustement inventaire #{locked_count.id}: '
                        f'{snapshot_difference:+d}'
                    ),
                    created_by=user,
                )
                product.refresh_from_db(fields=['stock'])
                adjustments.append({
                    'product': product.name,
                    'expected': item.expected_quantity,
                    'stock_before_validation': before,
                    'counted': item.counted_quantity,
                    'stock_after_adjustment': target,
                    'difference': snapshot_difference,
                    'movement_id': movement.id,
                })
            ProductCostLayer.assert_matches_stock(product)

        locked_count.status = InventoryCount.CountStatus.VALIDATED
        locked_count.validated_by = user
        if not locked_count.completed_at:
            locked_count.completed_at = timezone.now()
        locked_count.save(update_fields=[
            'status', 'validated_by', 'completed_at'
        ])
        return locked_count, adjustments


class InventoryCountCreateSerializer(serializers.ModelSerializer):
    items = InventoryCountCreateItemSerializer(
        many=True, allow_empty=False, write_only=True
    )
    auto_validate = serializers.BooleanField(default=False, write_only=True)

    class Meta:
        model = InventoryCount
        fields = ['id', 'name', 'status', 'notes', 'items', 'auto_validate']
        read_only_fields = ['id', 'status']

    def validate_items(self, value):
        product_ids = [item['product'].pk for item in value]
        if len(product_ids) != len(set(product_ids)):
            raise serializers.ValidationError(
                'Un produit ne peut apparaître qu’une fois dans un inventaire.'
            )
        return value

    def validate(self, attrs):
        if attrs.get('auto_validate') and any(
            item.get('counted_quantity') is None for item in attrs.get('items', [])
        ):
            raise serializers.ValidationError({
                'items': 'Toutes les quantités sont requises pour la validation automatique.'
            })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        auto_validate = validated_data.pop('auto_validate', False)
        validated_data['counted_by'] = self.context['request'].user
        product_ids = [item['product'].pk for item in items_data]
        products = {
            product.pk: product
            for product in Product.objects.select_for_update()
            .filter(pk__in=product_ids)
            .order_by('pk')
        }
        missing_products = sorted(set(product_ids) - set(products))
        if missing_products:
            raise serializers.ValidationError({
                'items': f'Produits indisponibles: {missing_products}.'
            })
        conflicting_products = list(
            InventoryCountItem.objects.filter(
                product_id__in=product_ids,
                count__status__in=[
                    InventoryCount.CountStatus.IN_PROGRESS,
                    InventoryCount.CountStatus.COMPLETED,
                ],
            ).values_list('product_id', flat=True).distinct()
        )
        if conflicting_products:
            raise serializers.ValidationError({
                'items': (
                    'Un comptage non validé existe déjà pour les produits: '
                    f'{sorted(conflicting_products)}.'
                )
            })
        count = InventoryCount.objects.create(**validated_data)
        InventoryCountItem.objects.bulk_create([
            InventoryCountItem(
                count=count,
                product=products[item['product'].pk],
                expected_quantity=products[item['product'].pk].stock,
                counted_quantity=item.get('counted_quantity'),
            )
            for item in items_data
        ])

        if auto_validate:
            count.status = InventoryCount.CountStatus.COMPLETED
            count.completed_at = timezone.now()
            count.save(update_fields=['status', 'completed_at'])
            count, _adjustments = validate_inventory_count(
                count,
                self.context['request'].user,
            )
        return count

