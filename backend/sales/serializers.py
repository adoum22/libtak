from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import serializers

from inventory.models import Product, ProductCostLayer
from .models import Discount, Return, ReturnItem, Sale, SaleItem


class SaleItemSerializer(serializers.ModelSerializer):
    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(),
        source='product',
    )
    quantity = serializers.IntegerField(min_value=1)

    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_id', 'product_name', 'quantity',
            'unit_price_ht', 'total_price_ht', 'tva_rate',
            'unit_purchase_price', 'total_purchase_cost',
        )
        read_only_fields = (
            'product_name', 'unit_price_ht', 'total_price_ht', 'tva_rate',
            'unit_purchase_price', 'total_purchase_cost',
        )


class SaleItemDetailSerializer(serializers.ModelSerializer):
    """Serializer detaille pour affichage."""
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)

    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_name', 'product_barcode', 'quantity',
            'unit_price_ht', 'total_price_ht', 'tva_rate',
            'unit_purchase_price', 'total_purchase_cost',
        )


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True)
    user = serializers.StringRelatedField(read_only=True)
    discount_amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.00'),
        required=False,
        default=Decimal('0.00'),
    )
    customer_id = serializers.IntegerField(
        required=False, allow_null=True, write_only=True,
    )
    credit = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = (
            'id', 'user', 'items',
            'total_ht', 'total_tva', 'total_ttc', 'discount_amount',
            'payment_method', 'created_at',
            'customer_id', 'credit',
        )
        read_only_fields = (
            'user', 'total_ht', 'total_tva', 'total_ttc', 'created_at',
        )

    def get_credit(self, obj):
        credit = getattr(obj, 'credit', None)
        if not credit:
            return None
        return {
            'id': credit.id,
            'customer_id': credit.customer_id,
            'customer_name': credit.customer.name,
            'status': credit.status,
            'paid_amount': float(credit.paid_amount),
        }

    def validate(self, attrs):
        payment_method = attrs.get('payment_method') or Sale.PaymentMethod.CASH
        customer_id = attrs.get('customer_id')
        if payment_method == Sale.PaymentMethod.CREDIT and not customer_id:
            raise serializers.ValidationError({
                'customer_id': (
                    "Un client est requis pour une vente à crédit."
                ),
            })
        if customer_id and payment_method != Sale.PaymentMethod.CREDIT:
            # Ignorer silencieusement le client si la vente n'est pas à crédit
            attrs.pop('customer_id', None)
        return attrs

    def _send_stock_updates(self, stock_updates):
        for product_id, new_stock in stock_updates:
            try:
                from asgiref.sync import async_to_sync
                from channels.layers import get_channel_layer

                channel_layer = get_channel_layer()
                if channel_layer:
                    async_to_sync(channel_layer.group_send)(
                        'stock_updates',
                        {
                            'type': 'stock_update',
                            'message': {
                                'product_id': product_id,
                                'new_stock': new_stock,
                            },
                        },
                    )
            except Exception:
                pass

    def _decrement_product_stock(self, product, quantity):
        updated = Product.objects.filter(
            id=product.id,
            stock__gte=quantity,
        ).update(
            stock=F('stock') - quantity,
            updated_at=timezone.now(),
        )

        if updated != 1:
            current = Product.objects.filter(id=product.id).only(
                'name', 'stock',
            ).first()
            if not current:
                raise serializers.ValidationError("Produit introuvable.")
            raise serializers.ValidationError(
                f"Stock insuffisant pour {current.name}. "
                f"Disponible: {current.stock}"
            )

        product.refresh_from_db(fields=['stock'])
        return product.stock

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        user = validated_data.pop('user', None) or self.context['request'].user
        discount_amount = validated_data.pop('discount_amount', Decimal('0.00'))
        customer_id = validated_data.pop('customer_id', None)
        payment_method = validated_data.get(
            'payment_method', Sale.PaymentMethod.CASH,
        )

        product_quantities = {}
        for item_data in items_data:
            product_id = item_data['product'].id
            product_quantities[product_id] = (
                product_quantities.get(product_id, 0) + item_data['quantity']
            )

        stock_updates = []
        with transaction.atomic():
            locked_products = {
                product.id: product
                for product in Product.objects.select_for_update()
                .filter(id__in=product_quantities.keys())
                .order_by('id')
            }

            total_ht = 0
            total_tva = 0
            prepared_items = []

            for product_id in sorted(product_quantities):
                quantity = product_quantities[product_id]
                product = locked_products.get(product_id)
                if not product:
                    raise serializers.ValidationError("Produit introuvable.")
                if product.stock < quantity:
                    raise serializers.ValidationError(
                        f"Stock insuffisant pour {product.name}. "
                        f"Disponible: {product.stock}"
                    )

                tva_rate = Decimal('0.00')
                for chunk in ProductCostLayer.consume_fifo_breakdown(product, quantity):
                    unit_price = chunk['sale_price']
                    chunk_quantity = chunk['quantity']
                    line_ht = unit_price * chunk_quantity
                    total_ht += line_ht
                    prepared_items.append({
                        'product': product,
                        'quantity': chunk_quantity,
                        'unit_price_ht': unit_price,
                        'total_price_ht': line_ht,
                        'tva_rate': tva_rate,
                        'product_name': product.name,
                        'purchase_cost': chunk['total_cost'],
                        'unit_cost': chunk['unit_cost'],
                    })

            total_ttc_before_discount = total_ht + total_tva
            if discount_amount > total_ttc_before_discount:
                raise serializers.ValidationError({
                    'discount_amount': (
                        "La reduction ne peut pas depasser le total a payer."
                    ),
                })

            total_ttc = total_ttc_before_discount - discount_amount
            if total_ttc_before_discount > 0:
                discount_ratio = total_ttc / total_ttc_before_discount
                total_ht = (total_ht * discount_ratio).quantize(
                    Decimal('0.01'),
                    rounding=ROUND_HALF_UP,
                )
                total_tva = (total_ttc - total_ht).quantize(
                    Decimal('0.01'),
                    rounding=ROUND_HALF_UP,
                )

            sale = Sale.objects.create(
                user=user,
                total_ht=total_ht,
                total_tva=total_tva,
                total_ttc=total_ttc,
                discount_amount=discount_amount,
                **validated_data,
            )

            for item in prepared_items:
                product = item['product']
                purchase_cost = item.pop('purchase_cost')
                item.pop('unit_cost', None)
                avg_purchase_price = Decimal('0.00')
                if item['quantity'] > 0:
                    avg_purchase_price = (purchase_cost / item['quantity']).quantize(
                        Decimal('0.01'),
                        rounding=ROUND_HALF_UP,
                    )
                SaleItem.objects.create(
                    sale=sale,
                    unit_purchase_price=avg_purchase_price,
                    total_purchase_cost=purchase_cost.quantize(
                        Decimal('0.01'),
                        rounding=ROUND_HALF_UP,
                    ),
                    **item,
                )
                new_stock = self._decrement_product_stock(
                    product,
                    item['quantity'],
                )
                stock_updates.append((product.id, new_stock))

            if payment_method == Sale.PaymentMethod.CREDIT:
                from credit.models import CreditSale, Customer
                try:
                    customer = Customer.objects.get(pk=customer_id)
                except Customer.DoesNotExist:
                    raise serializers.ValidationError({
                        'customer_id': "Client introuvable.",
                    })
                CreditSale.objects.create(sale=sale, customer=customer)

        self._send_stock_updates(stock_updates)
        return sale


class SaleDetailSerializer(serializers.ModelSerializer):
    """Serializer detaille pour l'affichage d'une vente."""
    items = SaleItemDetailSerializer(many=True, read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)
    payment_method_display = serializers.CharField(
        source='get_payment_method_display',
        read_only=True,
    )

    class Meta:
        model = Sale
        fields = (
            'id', 'user_name', 'items',
            'total_ht', 'total_tva', 'total_ttc', 'discount_amount',
            'payment_method', 'payment_method_display',
            'created_at',
        )


class DiscountSerializer(serializers.ModelSerializer):
    """Serializer for discounts/promotions."""
    is_valid = serializers.BooleanField(read_only=True)
    discount_type_display = serializers.CharField(
        source='get_discount_type_display',
        read_only=True,
    )

    class Meta:
        model = Discount
        fields = (
            'id', 'name', 'code', 'discount_type', 'discount_type_display',
            'value', 'min_purchase', 'max_uses', 'uses_count',
            'active', 'start_date', 'end_date', 'is_valid', 'created_at',
        )
        read_only_fields = ('uses_count', 'created_at')


class DiscountApplySerializer(serializers.Serializer):
    """Serializer for applying a discount code."""
    code = serializers.CharField(max_length=50)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)

    def validate_code(self, value):
        try:
            discount = Discount.objects.get(code__iexact=value)
            if not discount.is_valid:
                raise serializers.ValidationError(
                    "This discount code is no longer valid."
                )
            return value
        except Discount.DoesNotExist:
            raise serializers.ValidationError("Invalid discount code.")

    def validate(self, data):
        discount = Discount.objects.get(code__iexact=data['code'])
        if data['subtotal'] < discount.min_purchase:
            raise serializers.ValidationError({
                'subtotal': (
                    f"Minimum purchase of {discount.min_purchase} DH required."
                ),
            })
        return data


class ReturnItemSerializer(serializers.ModelSerializer):
    """Serializer for return items."""
    product_name = serializers.CharField(source='sale_item.product_name', read_only=True)
    unit_price = serializers.DecimalField(
        source='sale_item.unit_price_ht',
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )
    quantity = serializers.IntegerField(min_value=1)

    class Meta:
        model = ReturnItem
        fields = ('id', 'sale_item', 'quantity', 'product_name', 'unit_price')


class ReturnSerializer(serializers.ModelSerializer):
    """Serializer for returns."""
    items = ReturnItemSerializer(many=True)
    status_display = serializers.CharField(
        source='get_status_display',
        read_only=True,
    )
    processed_by_name = serializers.CharField(
        source='processed_by.username',
        read_only=True,
    )
    sale_total = serializers.DecimalField(
        source='sale.total_ttc',
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = Return
        fields = (
            'id', 'sale', 'sale_total', 'status', 'status_display',
            'reason', 'refund_amount', 'items',
            'processed_by', 'processed_by_name',
            'created_at', 'updated_at',
        )
        read_only_fields = ('processed_by', 'created_at', 'updated_at')

    def _returned_quantity(self, sale_item):
        return ReturnItem.objects.filter(
            sale_item=sale_item,
        ).exclude(
            return_order__status=Return.ReturnStatus.REJECTED,
        ).aggregate(total=Sum('quantity'))['total'] or 0

    def _validate_items(self, sale, items_data):
        for item_data in items_data:
            sale_item = item_data['sale_item']
            qty = item_data['quantity']

            if sale_item.sale_id != sale.id:
                raise serializers.ValidationError({
                    'items': (
                        f"L'article {sale_item.id} n'appartient pas "
                        f"a la vente {sale.id}."
                    ),
                })

            already_returned = self._returned_quantity(sale_item)
            available = sale_item.quantity - already_returned
            if qty > available:
                raise serializers.ValidationError({
                    'items': (
                        f"Quantite retournee invalide pour "
                        f"{sale_item.product_name}. Disponible: {available}."
                    ),
                })

    def validate(self, attrs):
        items_data = attrs.get('items', [])
        sale = attrs.get('sale')
        if not items_data:
            raise serializers.ValidationError({
                'items': 'Au moins un article est requis.',
            })
        if sale:
            self._validate_items(sale, items_data)
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        user = self.context['request'].user

        with transaction.atomic():
            sale_item_ids = sorted(item['sale_item'].id for item in items_data)
            SaleItem.objects.filter(id__in=sale_item_ids).update(
                quantity=F('quantity'),
            )
            locked_sale_items = {
                sale_item.id: sale_item
                for sale_item in SaleItem.objects.select_for_update()
                .filter(id__in=sale_item_ids)
                .order_by('id')
            }
            for item in items_data:
                item['sale_item'] = locked_sale_items.get(
                    item['sale_item'].id,
                    item['sale_item'],
                )

            self._validate_items(validated_data['sale'], items_data)

            product_ids = [
                item['sale_item'].product_id
                for item in items_data
                if item['sale_item'].product_id
            ]
            products = {
                product.id: product
                for product in Product.objects.select_for_update()
                .filter(id__in=product_ids)
                .order_by('id')
            }

            refund_amount = 0
            sale_gross_ttc = sum(
                item.unit_price_ht * item.quantity
                for item in SaleItem.objects.filter(sale=validated_data['sale'])
            )
            refund_ratio = Decimal('1.00')
            if sale_gross_ttc > 0 and validated_data['sale'].total_ttc < sale_gross_ttc:
                refund_ratio = validated_data['sale'].total_ttc / sale_gross_ttc

            for item_data in items_data:
                sale_item = item_data['sale_item']
                qty = item_data['quantity']
                unit_ttc = sale_item.unit_price_ht
                refund_amount += unit_ttc * qty * refund_ratio

            validated_data['refund_amount'] = refund_amount.quantize(
                Decimal('0.01'),
                rounding=ROUND_HALF_UP,
            )
            validated_data['processed_by'] = user
            return_order = Return.objects.create(**validated_data)

            for item_data in items_data:
                ReturnItem.objects.create(return_order=return_order, **item_data)

                sale_item = item_data['sale_item']
                product = products.get(sale_item.product_id)
                if product:
                    product.stock += item_data['quantity']
                    product.save(update_fields=['stock', 'updated_at'])
                    ProductCostLayer.create_layer(
                        product=product,
                        quantity=item_data['quantity'],
                        unit_cost=sale_item.unit_purchase_price,
                        sale_price=sale_item.unit_price_ht,
                        note=f'Retour vente #{validated_data["sale"].id}',
                    )

        return return_order
