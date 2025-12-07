from rest_framework import serializers
from .models import Sale, SaleItem
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
