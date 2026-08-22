import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from inventory.models import Product, ProductCostLayer, StockMovement
from .models import Discount, Return, ReturnItem, Sale, SaleItem


DISCOUNT_CODE_CONFLICT = 'Ce code de remise existe deja.'


def find_discount_by_code(code, *, for_update=False):
    """Return a deterministic valid promotion without ever assuming uniqueness.

    The database now enforces case-insensitive uniqueness, but the defensive
    selection also keeps requests safe while an older database is being
    migrated or if legacy data was imported outside normal application flows.
    """
    normalized = str(code or '').strip().upper()
    if not normalized:
        return None
    queryset = Discount.objects.filter(code__iexact=normalized).order_by(
        '-active', '-uses_count', 'id',
    )
    if for_update:
        queryset = queryset.select_for_update()
    candidates = list(queryset)
    if not candidates:
        return None
    return next((candidate for candidate in candidates if candidate.is_valid), candidates[0])


class SaleItemSerializer(serializers.ModelSerializer):
    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.filter(active=True),
        source='product',
    )
    quantity = serializers.IntegerField(min_value=1)
    returnable_quantity = serializers.SerializerMethodField()

    @extend_schema_field(serializers.IntegerField)
    def get_returnable_quantity(self, obj) -> int:
        returned = getattr(obj, 'returned_quantity', None)
        if returned is None:
            returned = (
                ReturnItem.objects.filter(sale_item=obj)
                .exclude(return_order__status=Return.ReturnStatus.REJECTED)
                .aggregate(total=Sum('quantity'))['total']
                or 0
            )
        return max(obj.quantity - returned, 0)

    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_id', 'product_name', 'quantity',
            'returnable_quantity', 'unit_price_ht', 'total_price_ht', 'tva_rate',
        )
        read_only_fields = (
            'product_name', 'unit_price_ht', 'total_price_ht', 'tva_rate',
        )


class SaleItemDetailSerializer(serializers.ModelSerializer):
    """Serializer detaille pour affichage."""
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    returnable_quantity = serializers.SerializerMethodField()

    @extend_schema_field(serializers.IntegerField)
    def get_returnable_quantity(self, obj) -> int:
        returned = getattr(obj, 'returned_quantity', None)
        if returned is None:
            returned = (
                ReturnItem.objects.filter(sale_item=obj)
                .exclude(return_order__status=Return.ReturnStatus.REJECTED)
                .aggregate(total=Sum('quantity'))['total']
                or 0
            )
        return max(obj.quantity - returned, 0)

    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_name', 'product_barcode', 'quantity',
            'returnable_quantity', 'unit_price_ht', 'total_price_ht', 'tva_rate',
        )


def sale_payload_hash(data):
    """Return a stable hash for an idempotent POS request.

    The hash deliberately contains only fields that change the financial or
    stock effect. Formatting differences such as ``"10"`` vs ``"10.00"`` do
    not create a different request.
    """
    aggregated = {}
    for item in data.get('items') or []:
        product = item.get('product_id', item.get('product'))
        if hasattr(product, 'pk'):
            product = product.pk
        product = int(product)
        aggregated[product] = aggregated.get(product, 0) + int(item['quantity'])

    def money(value, default='0'):
        try:
            return str(Decimal(str(value if value not in (None, '') else default)).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            ))
        except (InvalidOperation, TypeError, ValueError):
            return str(value)

    canonical = {
        'items': sorted(aggregated.items()),
        'payment_method': data.get('payment_method') or Sale.PaymentMethod.CASH,
        'amount_received': money(data.get('amount_received')),
        'discount_amount': money(data.get('discount_amount')),
        'discount_code': (data.get('discount_code') or '').strip().upper(),
    }
    encoded = json.dumps(canonical, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def return_payload_hash(data):
    aggregated = {}
    for item in data.get('items') or []:
        sale_item = item.get('sale_item')
        if hasattr(sale_item, 'pk'):
            sale_item = sale_item.pk
        sale_item = int(sale_item)
        row = aggregated.setdefault(sale_item, {'quantity': 0, 'restock': True})
        row['quantity'] += int(item['quantity'])
        row['restock'] = row['restock'] and bool(item.get('restock', True))
    sale = data.get('sale')
    if hasattr(sale, 'pk'):
        sale = sale.pk
    canonical = {
        'sale': int(sale),
        'items': [
            [key, row['quantity'], row['restock']]
            for key, row in sorted(aggregated.items())
        ],
        'reason': (data.get('reason') or '').strip(),
        'refund_method': data.get('refund_method') or '',
    }
    encoded = json.dumps(canonical, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


class SaleCreditSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    customer_id = serializers.IntegerField()
    customer_name = serializers.CharField()
    status = serializers.CharField()
    paid_amount = serializers.FloatField()
    adjusted_total = serializers.FloatField()
    remaining_amount = serializers.FloatField()


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, allow_empty=False)
    user = serializers.StringRelatedField(read_only=True)
    idempotency_key = serializers.RegexField(
        source='local_sync_id',
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        required=False,
    )
    expected_total = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.00'),
        required=False,
        write_only=True,
    )
    discount_code = serializers.CharField(
        max_length=50,
        required=False,
        allow_blank=False,
    )
    amount_received = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.00'),
        required=False,
    )
    discount_amount = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.00'),
        required=False,
        default=Decimal('0.00'),
    )
    customer_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        write_only=True,
    )
    credit = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = (
            'id', 'user', 'items',
            'total_ht', 'total_tva', 'total_ttc', 'discount_amount',
            'payment_method', 'amount_received', 'change_amount',
            'idempotency_key', 'expected_total', 'discount_code', 'created_at',
            'customer_id', 'credit',
        )
        read_only_fields = (
            'user', 'total_ht', 'total_tva', 'total_ttc', 'change_amount',
            'created_at',
        )

    @extend_schema_field(SaleCreditSummarySerializer)
    def get_credit(self, obj) -> dict[str, object] | None:
        credit = getattr(obj, 'credit', None)
        if not credit:
            return None
        return {
            'id': credit.id,
            'customer_id': credit.customer_id,
            'customer_name': credit.customer.name,
            'status': credit.status,
            'paid_amount': float(credit.paid_amount),
            'adjusted_total': float(credit.adjusted_total),
            'remaining_amount': float(credit.remaining_amount),
        }

    def validate(self, attrs):
        request = self.context.get('request')
        payment_method = attrs.get('payment_method') or Sale.PaymentMethod.CASH
        customer_id = attrs.get('customer_id')
        if payment_method == Sale.PaymentMethod.CREDIT and not customer_id:
            raise serializers.ValidationError({
                'customer_id': 'Un client est requis pour une vente à crédit.',
            })
        if customer_id and payment_method != Sale.PaymentMethod.CREDIT:
            attrs.pop('customer_id', None)
        direct_discount = attrs.get('discount_amount', Decimal('0.00'))
        if (
            direct_discount > 0
            and not attrs.get('discount_code')
            and request
            and not request.user.is_admin_role
        ):
            raise serializers.ValidationError({
                'discount_amount': (
                    "Une remise libre exige un compte administrateur. "
                    "Utilisez un code de remise valide."
                ),
            })
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
        discount_code = validated_data.pop('discount_code', None)
        expected_total = validated_data.pop('expected_total', None)
        requested_amount = validated_data.pop('amount_received', None)
        idempotency_key = validated_data.get('local_sync_id')
        payload_hash = sale_payload_hash({
            'items': items_data,
            'payment_method': validated_data.get(
                'payment_method', Sale.PaymentMethod.CASH,
            ),
            'amount_received': requested_amount,
            'discount_amount': discount_amount,
            'discount_code': discount_code,
            'customer_id': customer_id,
        })

        product_quantities = {}
        for item_data in items_data:
            product_id = item_data['product'].id
            product_quantities[product_id] = (
                product_quantities.get(product_id, 0) + item_data['quantity']
            )

        stock_updates = []
        with transaction.atomic():
            credit_customer = None
            payment_method = validated_data.get(
                'payment_method', Sale.PaymentMethod.CASH,
            )
            if payment_method == Sale.PaymentMethod.CREDIT:
                from credit.models import Customer

                try:
                    credit_customer = Customer.objects.select_for_update().get(
                        pk=customer_id,
                    )
                except Customer.DoesNotExist as exc:
                    raise serializers.ValidationError({
                        'customer_id': 'Client introuvable.',
                    }) from exc

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
                if not product or not product.active:
                    raise serializers.ValidationError(
                        "Ce produit est introuvable ou n'est plus actif."
                    )
                if product.stock < quantity:
                    raise serializers.ValidationError(
                        f"Stock insuffisant pour {product.name}. "
                        f"Disponible: {product.stock}"
                    )

                tva_rate = Decimal('0.00')
                for chunk in ProductCostLayer.consume_fifo_breakdown(product, quantity):
                    # FIFO choisit le cout ; le prix courant du produit est
                    # identique pour tous les lots encore en stock.
                    unit_price = product.sale_price_ht
                    if unit_price <= 0:
                        raise serializers.ValidationError({
                            'items': (
                                f"Le prix de vente de {product.name} n'est pas "
                                "configuré. Corrigez sa fiche avant de le vendre."
                            ),
                        })
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

            total_ttc_before_discount = (total_ht + total_tva).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            )

            discount = None
            if discount_code:
                discount = find_discount_by_code(
                    discount_code,
                    for_update=True,
                )
                if not discount or not discount.is_valid:
                    raise serializers.ValidationError({
                        'discount_code': 'Ce code de remise est invalide ou expire.',
                    })
                if total_ttc_before_discount < discount.min_purchase:
                    raise serializers.ValidationError({
                        'discount_code': (
                            f"Achat minimum requis: {discount.min_purchase} DH."
                        ),
                    })
                discount_amount = Decimal(
                    discount.calculate_discount(total_ttc_before_discount)
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

            if discount_amount > total_ttc_before_discount:
                raise serializers.ValidationError({
                    'discount_amount': (
                        "La reduction ne peut pas depasser le total a payer."
                    ),
                })

            total_ttc = (total_ttc_before_discount - discount_amount).quantize(
                Decimal('0.01'), rounding=ROUND_HALF_UP,
            )

            if expected_total is not None:
                expected_total = expected_total.quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
                if expected_total != total_ttc:
                    raise serializers.ValidationError({
                        'expected_total': (
                            "Le prix a change depuis l'ajout au panier. "
                            f"Total actuel: {total_ttc}."
                        ),
                        'server_total': str(total_ttc),
                    })

            payment_method = validated_data.get(
                'payment_method', Sale.PaymentMethod.CASH,
            )
            if payment_method == Sale.PaymentMethod.CASH:
                if requested_amount is None:
                    raise serializers.ValidationError({
                        'amount_received': 'Le montant recu est obligatoire en especes.',
                    })
                if requested_amount < total_ttc:
                    raise serializers.ValidationError({
                        'amount_received': (
                            f"Montant insuffisant. Total a payer: {total_ttc}."
                        ),
                    })
                amount_received = requested_amount
                change_amount = (requested_amount - total_ttc).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
            elif payment_method == Sale.PaymentMethod.CREDIT:
                if requested_amount not in (None, Decimal('0.00')):
                    raise serializers.ValidationError({
                        'amount_received': (
                            "Une vente à crédit ne peut pas enregistrer "
                            "d'encaissement immédiat."
                        ),
                    })
                amount_received = Decimal('0.00')
                change_amount = Decimal('0.00')
            else:
                if requested_amount is not None and requested_amount != total_ttc:
                    raise serializers.ValidationError({
                        'amount_received': (
                            "Pour un paiement sans especes, le montant doit "
                            "correspondre exactement au total."
                        ),
                    })
                amount_received = total_ttc
                change_amount = Decimal('0.00')

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
                discount_code=discount.code if discount else '',
                amount_received=amount_received,
                change_amount=change_amount,
                idempotency_payload_hash=payload_hash if idempotency_key else '',
                **validated_data,
            )

            if discount:
                Discount.objects.filter(pk=discount.pk).update(
                    uses_count=F('uses_count') + 1,
                )

            stock_before_by_product = {
                product_id: product.stock
                for product_id, product in locked_products.items()
            }
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

            StockMovement.objects.bulk_create([
                StockMovement(
                    product_id=product_id,
                    movement_type=StockMovement.MovementType.OUT,
                    quantity=quantity,
                    stock_before=stock_before_by_product[product_id],
                    stock_after=locked_products[product_id].stock,
                    reference=f'VENTE-{sale.id}',
                    notes='Sortie generee automatiquement lors de la vente.',
                    created_by=user,
                )
                for product_id, quantity in sorted(product_quantities.items())
            ])

            if credit_customer is not None:
                from credit.models import CreditSale

                CreditSale.objects.create(
                    sale=sale,
                    customer=credit_customer,
                )

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
    idempotency_key = serializers.CharField(
        source='local_sync_id', read_only=True,
    )

    class Meta:
        model = Sale
        fields = (
            'id', 'user_name', 'items',
            'total_ht', 'total_tva', 'total_ttc', 'discount_amount', 'discount_code',
            'payment_method', 'payment_method_display',
            'amount_received', 'change_amount', 'idempotency_key', 'created_at',
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

    def validate_code(self, value):
        if value is None:
            return None
        normalized = value.strip().upper()
        if not normalized:
            return None
        duplicates = Discount.objects.filter(code__iexact=normalized)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(DISCOUNT_CODE_CONFLICT)
        return normalized

    def validate(self, attrs):
        discount_type = attrs.get(
            'discount_type', getattr(self.instance, 'discount_type', None),
        )
        value = attrs.get('value', getattr(self.instance, 'value', None))
        max_uses = attrs.get('max_uses', getattr(self.instance, 'max_uses', 0))
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if value is None or value <= 0:
            raise serializers.ValidationError({'value': 'La remise doit etre positive.'})
        if discount_type == Discount.DiscountType.PERCENTAGE and value > 100:
            raise serializers.ValidationError({'value': 'Le pourcentage ne peut pas depasser 100.'})
        if max_uses < 0:
            raise serializers.ValidationError({'max_uses': 'La limite ne peut pas etre negative.'})
        min_purchase = attrs.get(
            'min_purchase', getattr(self.instance, 'min_purchase', Decimal('0')),
        )
        if min_purchase < 0:
            raise serializers.ValidationError({
                'min_purchase': 'Le minimum d achat ne peut pas etre negatif.',
            })
        if start and end and start > end:
            raise serializers.ValidationError({'end_date': 'La date de fin precede la date de debut.'})
        return attrs

    def create(self, validated_data):
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError as exc:
            raise serializers.ValidationError({
                'code': DISCOUNT_CODE_CONFLICT,
            }) from exc

    def update(self, instance, validated_data):
        try:
            with transaction.atomic():
                return super().update(instance, validated_data)
        except IntegrityError as exc:
            raise serializers.ValidationError({
                'code': DISCOUNT_CODE_CONFLICT,
            }) from exc


class DiscountApplySerializer(serializers.Serializer):
    """Serializer for applying a discount code."""
    code = serializers.CharField(max_length=50)
    subtotal = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=Decimal('0.00'),
    )

    def validate(self, data):
        discount = find_discount_by_code(data['code'])
        if discount is None:
            raise serializers.ValidationError({
                'code': 'Ce code de remise est invalide.',
            })
        if not discount.is_valid:
            raise serializers.ValidationError({
                'code': 'Ce code de remise est expire ou epuise.',
            })
        if data['subtotal'] < discount.min_purchase:
            raise serializers.ValidationError({
                'subtotal': (
                    f"Minimum purchase of {discount.min_purchase} DH required."
                ),
            })
        self.discount = discount
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
        fields = (
            'id', 'sale_item', 'quantity', 'restock',
            'product_name', 'unit_price',
        )


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
    idempotency_key = serializers.RegexField(
        source='local_sync_id',
        regex=r'^[A-Za-z0-9._:-]{8,64}$',
        required=False,
    )
    reason = serializers.CharField(min_length=3, max_length=2000)

    class Meta:
        model = Return
        fields = (
            'id', 'sale', 'sale_total', 'status', 'status_display',
            'reason', 'refund_amount', 'cash_refund_amount',
            'refund_method', 'items',
            'processed_by_name', 'idempotency_key',
            'stock_restored_at', 'completed_at', 'created_at', 'updated_at',
        )
        read_only_fields = (
            'status', 'refund_amount', 'cash_refund_amount', 'processed_by_name',
            'stock_restored_at', 'completed_at', 'created_at', 'updated_at',
        )

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
        aggregated = {}
        for item in items_data:
            key = item['sale_item'].pk
            if key in aggregated:
                aggregated[key]['quantity'] += item['quantity']
                aggregated[key]['restock'] = (
                    aggregated[key].get('restock', True)
                    and item.get('restock', True)
                )
            else:
                aggregated[key] = dict(item)
        items_data = list(aggregated.values())
        attrs['items'] = items_data
        if sale:
            self._validate_items(sale, items_data)
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        user = self.context['request'].user
        idempotency_key = validated_data.get('local_sync_id')
        payload_hash = return_payload_hash(
            getattr(self, 'initial_data', {
                **validated_data,
                'items': items_data,
            })
        )

        with transaction.atomic():
            sale = Sale.objects.select_for_update().get(pk=validated_data['sale'].pk)
            validated_data['sale'] = sale
            sale_item_ids = sorted(item['sale_item'].id for item in items_data)
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

            sale = validated_data['sale']
            sale_gross_ttc = sum(
                item.unit_price_ht * item.quantity
                for item in SaleItem.objects.filter(sale=sale)
            )
            previous_returns = Return.objects.filter(sale=sale).exclude(
                status=Return.ReturnStatus.REJECTED,
            )
            already_refunded = (
                previous_returns.aggregate(total=Sum('refund_amount'))['total']
                or Decimal('0.00')
            )
            already_returned_gross = sum(
                return_item.sale_item.unit_price_ht * return_item.quantity
                for return_item in ReturnItem.objects.filter(
                    return_order__in=previous_returns,
                ).select_related('sale_item')
            )
            current_return_gross = sum(
                item_data['sale_item'].unit_price_ht * item_data['quantity']
                for item_data in items_data
            )

            cumulative_refund = Decimal('0.00')
            if sale_gross_ttc > 0:
                cumulative_return_gross = min(
                    sale_gross_ttc,
                    already_returned_gross + current_return_gross,
                )
                if cumulative_return_gross == sale_gross_ttc:
                    # The final return owns every cent that remains.  This
                    # avoids both over-refunds and a stranded rounding cent.
                    cumulative_refund = sale.total_ttc
                else:
                    cumulative_refund = (
                        sale.total_ttc
                        * cumulative_return_gross
                        / sale_gross_ttc
                    ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

            remaining_refundable = max(
                sale.total_ttc - already_refunded,
                Decimal('0.00'),
            )
            refund_amount = max(
                cumulative_refund - already_refunded,
                Decimal('0.00'),
            )
            validated_data['refund_amount'] = min(
                refund_amount,
                remaining_refundable,
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            refund_method_supplied = (
                'refund_method' in getattr(self, 'initial_data', {})
            )
            if (
                sale.payment_method == Sale.PaymentMethod.CREDIT
                and not refund_method_supplied
            ):
                # Aucun décaissement n'a lieu tant que le retour crédit n'est
                # pas finalisé; la complétion calculera l'éventuel trop-perçu.
                validated_data['refund_method'] = Sale.PaymentMethod.CREDIT
            else:
                validated_data.setdefault('refund_method', sale.payment_method)
            validated_data['cash_refund_amount'] = Decimal('0.00')
            validated_data['processed_by'] = user
            validated_data['idempotency_payload_hash'] = (
                payload_hash if idempotency_key else ''
            )
            return_order = Return.objects.create(**validated_data)

            for item_data in items_data:
                ReturnItem.objects.create(return_order=return_order, **item_data)

        return return_order
