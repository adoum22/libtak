from rest_framework import serializers
from .models import Sale, SaleItem, Discount, Return, ReturnItem
from inventory.models import Product


class SaleItemSerializer(serializers.ModelSerializer):
    product_id = serializers.PrimaryKeyRelatedField(
        queryset=Product.objects.all(), 
        source='product'
    )
    
    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_id', 'product_name', 'quantity', 
            'unit_price_ht', 'total_price_ht', 'tva_rate'
        )
        read_only_fields = ('product_name', 'unit_price_ht', 'total_price_ht', 'tva_rate')


class SaleItemDetailSerializer(serializers.ModelSerializer):
    """Serializer détaillé pour affichage"""
    product_barcode = serializers.CharField(source='product.barcode', read_only=True)
    
    class Meta:
        model = SaleItem
        fields = (
            'id', 'product_name', 'product_barcode', 'quantity',
            'unit_price_ht', 'total_price_ht', 'tva_rate'
        )


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True)
    user = serializers.StringRelatedField(read_only=True)

    class Meta:
        model = Sale
        fields = (
            'id', 'user', 'items', 
            'total_ht', 'total_tva', 'total_ttc', 
            'payment_method', 'created_at'
        )
        read_only_fields = ('user', 'total_ht', 'total_tva', 'total_ttc', 'created_at')

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        # Eviter duplication si 'user' est passé par save() et context
        user = validated_data.pop('user', None) or self.context['request'].user
        
        # Calculate totals
        total_ht = 0
        total_tva = 0
        total_cost = 0  # Pour calculer le bénéfice
        
        # Prepare items and check stock
        prepared_items = []
        
        for item_data in items_data:
            product = item_data['product']
            quantity = item_data['quantity']
            
            if product.stock < quantity:
                raise serializers.ValidationError(
                    f"Stock insuffisant pour {product.name}. Disponible: {product.stock}"
                )
            
            # Utiliser sale_price_ht au lieu de price_ht
            unit_price_ht = product.sale_price_ht
            tva_rate = product.tva
            line_ht = unit_price_ht * quantity
            line_tva = line_ht * (tva_rate / 100)
            
            total_ht += line_ht
            total_tva += line_tva
            total_cost += product.purchase_price * quantity
            
            prepared_items.append({
                'product': product,
                'quantity': quantity,
                'unit_price_ht': unit_price_ht,
                'total_price_ht': line_ht,
                'tva_rate': tva_rate,
                'product_name': product.name
            })

        total_ttc = total_ht + total_tva

        sale = Sale.objects.create(
            user=user,
            total_ht=total_ht,
            total_tva=total_tva,
            total_ttc=total_ttc,
            **validated_data
        )

        for item in prepared_items:
            SaleItem.objects.create(sale=sale, **item)
            
            # Decrement stock
            product = item['product']
            product.stock -= item['quantity']
            product.save()
            
            # Send real-time update (avec gestion d'erreur si Redis non dispo)
            try:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync
                
                channel_layer = get_channel_layer()
                if channel_layer:
                    async_to_sync(channel_layer.group_send)(
                        'stock_updates',
                        {
                            'type': 'stock_update',
                            'message': {
                                'product_id': product.id,
                                'new_stock': product.stock
                            }
                        }
                    )
            except Exception:
                pass  # Ignorer si Redis/Channels non disponible

        return sale


class SaleDetailSerializer(serializers.ModelSerializer):
    """Serializer détaillé pour l'affichage d'une vente"""
    items = SaleItemDetailSerializer(many=True, read_only=True)
    user_name = serializers.CharField(source='user.username', read_only=True)
    payment_method_display = serializers.CharField(
        source='get_payment_method_display', 
        read_only=True
    )
    
    class Meta:
        model = Sale
        fields = (
            'id', 'user_name', 'items',
            'total_ht', 'total_tva', 'total_ttc',
            'payment_method', 'payment_method_display',
            'created_at'
        )


class DiscountSerializer(serializers.ModelSerializer):
    """Serializer for discounts/promotions"""
    is_valid = serializers.BooleanField(read_only=True)
    discount_type_display = serializers.CharField(
        source='get_discount_type_display',
        read_only=True
    )
    
    class Meta:
        model = Discount
        fields = (
            'id', 'name', 'code', 'discount_type', 'discount_type_display',
            'value', 'min_purchase', 'max_uses', 'uses_count',
            'active', 'start_date', 'end_date', 'is_valid', 'created_at'
        )
        read_only_fields = ('uses_count', 'created_at')


class DiscountApplySerializer(serializers.Serializer):
    """Serializer for applying a discount code"""
    code = serializers.CharField(max_length=50)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2)
    
    def validate_code(self, value):
        try:
            discount = Discount.objects.get(code__iexact=value)
            if not discount.is_valid:
                raise serializers.ValidationError("This discount code is no longer valid.")
            return value
        except Discount.DoesNotExist:
            raise serializers.ValidationError("Invalid discount code.")
    
    def validate(self, data):
        discount = Discount.objects.get(code__iexact=data['code'])
        if data['subtotal'] < discount.min_purchase:
            raise serializers.ValidationError({
                'subtotal': f"Minimum purchase of {discount.min_purchase} DH required."
            })
        return data


class ReturnItemSerializer(serializers.ModelSerializer):
    """Serializer for return items"""
    product_name = serializers.CharField(source='sale_item.product_name', read_only=True)
    unit_price = serializers.DecimalField(
        source='sale_item.unit_price_ht',
        max_digits=10,
        decimal_places=2,
        read_only=True
    )
    
    class Meta:
        model = ReturnItem
        fields = ('id', 'sale_item', 'quantity', 'product_name', 'unit_price')


class ReturnSerializer(serializers.ModelSerializer):
    """Serializer for returns"""
    items = ReturnItemSerializer(many=True)
    status_display = serializers.CharField(
        source='get_status_display',
        read_only=True
    )
    processed_by_name = serializers.CharField(
        source='processed_by.username',
        read_only=True
    )
    sale_total = serializers.DecimalField(
        source='sale.total_ttc',
        max_digits=10,
        decimal_places=2,
        read_only=True
    )
    
    class Meta:
        model = Return
        fields = (
            'id', 'sale', 'sale_total', 'status', 'status_display',
            'reason', 'refund_amount', 'items',
            'processed_by', 'processed_by_name',
            'created_at', 'updated_at'
        )
        read_only_fields = ('processed_by', 'created_at', 'updated_at')
    
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        user = self.context['request'].user
        
        # Calculate refund amount
        refund_amount = 0
        for item_data in items_data:
            sale_item = item_data['sale_item']
            qty = item_data['quantity']
            # Calculate with TVA
            unit_ttc = sale_item.unit_price_ht * (1 + sale_item.tva_rate / 100)
            refund_amount += unit_ttc * qty
        
        validated_data['refund_amount'] = refund_amount
        validated_data['processed_by'] = user
        
        return_order = Return.objects.create(**validated_data)
        
        for item_data in items_data:
            ReturnItem.objects.create(return_order=return_order, **item_data)
            
            # Restore stock
            sale_item = item_data['sale_item']
            if sale_item.product:
                sale_item.product.stock += item_data['quantity']
                sale_item.product.save()
        
        return return_order

