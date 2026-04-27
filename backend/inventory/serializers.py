from rest_framework import serializers
from core.image_validators import validate_image_upload
from .models import Category, Product, Supplier, StockMovement, ProductCostLayer, PurchaseOrder, PurchaseOrderItem, InventoryCount, InventoryCountItem


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
    
    def get_products_count(self, obj):
        return obj.products.count()

    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None

    def validate_image(self, value):
        return validate_image_upload(value)


class CategorySerializer(serializers.ModelSerializer):
    products_count = serializers.SerializerMethodField()
    
    class Meta:
        model = Category
        fields = ['id', 'name', 'description', 'icon', 'color', 'products_count']
    
    def get_products_count(self, obj):
        return obj.products.count()


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    price_ttc = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    profit_margin = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    profit_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    stock_value = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    is_low_stock = serializers.BooleanField(read_only=True)
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'barcode', 'description',
            'purchase_price', 'sale_price_ht', 'tva', 'price_ttc',
            'profit_margin', 'profit_percentage',
            'stock', 'min_stock', 'stock_value', 'is_low_stock',
            'category', 'category_name',
            'supplier', 'supplier_name',
            'image', 'image_url',
            'active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']
    
    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None

    def validate_image(self, value):
        return validate_image_upload(value)


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

    def create(self, validated_data):
        """Crée le produit ET le 1er layer FIFO si du stock initial est saisi.

        Sans ça, un nouveau produit avec stock>0 saisi depuis l'UI n'a pas
        de layer : la 1re vente déclenche `ensure_layers_cover_stock` qui
        crée un layer au `purchase_price` *actuel* (qui peut avoir change
        entre la creation du produit et la 1re vente). Le snapshot serait
        alors faux. On fige donc le coût initial dès la creation.
        """
        product = super().create(validated_data)
        if product.stock and product.stock > 0:
            ProductCostLayer.create_layer(
                product=product,
                quantity=product.stock,
                unit_cost=product.purchase_price,
                note='Stock initial à la création',
            )
        return product


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
            'quantity', 'unit_cost',
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
    
    def create(self, validated_data):
        validated_data['created_by'] = self.context['request'].user
        return super().create(validated_data)


class StockInSerializer(serializers.Serializer):
    """Serializer simplifié pour l'entrée de stock"""
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    unit_cost = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), required=False)
    reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    
    def create(self, validated_data):
        product = validated_data['product']
        
        # Si pas de coût unitaire fourni, utiliser le prix d'achat du produit
        unit_cost = validated_data.get('unit_cost', product.purchase_price)
        
        movement = StockMovement.objects.create(
            product=product,
            movement_type=StockMovement.MovementType.IN,
            quantity=validated_data['quantity'],
            unit_cost=unit_cost,
            supplier=validated_data.get('supplier'),
            reference=validated_data.get('reference', ''),
            notes=validated_data.get('notes', ''),
            created_by=self.context['request'].user
        )
        return movement


# ---- Purchase Order Serializers ----

class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source='product.name', read_only=True)
    current_sale_price = serializers.DecimalField(
        source='product.sale_price_ht',
        max_digits=10,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = PurchaseOrderItem
        fields = [
            'id', 'product', 'product_name', 'quantity', 'unit_cost',
            'sale_price', 'current_sale_price', 'received_quantity',
        ]
        read_only_fields = ['received_quantity']


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    
    class Meta:
        model = PurchaseOrder
        fields = [
            'id', 'reference', 'supplier', 'supplier_name', 
            'status', 'status_display', 'notes', 'expected_date',
            'items', 'total_amount',
            'created_by', 'created_by_name', 'created_at', 'updated_at'
        ]
        read_only_fields = ['reference', 'created_by', 'created_at', 'updated_at', 'total_amount']
    
    def create(self, validated_data):
        validated_data['created_by'] = self.context['request'].user
        return super().create(validated_data)


class PurchaseOrderCreateSerializer(serializers.ModelSerializer):
    items = serializers.ListField(child=serializers.DictField(), write_only=True)
    
    class Meta:
        model = PurchaseOrder
        fields = ['supplier', 'notes', 'expected_date', 'items']
    
    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        validated_data['created_by'] = self.context['request'].user
        order = PurchaseOrder.objects.create(**validated_data)
        
        for item in items_data:
            PurchaseOrderItem.objects.create(
                order=order,
                product_id=item['product'],
                quantity=item['quantity'],
                unit_cost=item.get('unit_cost', 0),
                sale_price=item.get('sale_price') or None,
            )
        
        return order


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
    
    class Meta:
        model = InventoryCount
        fields = ['id', 'name', 'status', 'status_display', 'notes',
                  'items', 'counted_by', 'created_by_name', 
                  'created_at', 'completed_at']
        read_only_fields = ['counted_by', 'created_at', 'completed_at']
    
    def create(self, validated_data):
        validated_data['counted_by'] = self.context['request'].user
        return super().create(validated_data)


class InventoryCountCreateSerializer(serializers.ModelSerializer):
    items = serializers.ListField(child=serializers.DictField(), write_only=True)
    auto_validate = serializers.BooleanField(default=True, write_only=True)
    
    class Meta:
        model = InventoryCount
        fields = ['name', 'notes', 'items', 'auto_validate']
    
    def create(self, validated_data):
        from .models import StockMovement
        
        items_data = validated_data.pop('items', [])
        auto_validate = validated_data.pop('auto_validate', True)
        validated_data['counted_by'] = self.context['request'].user
        count = InventoryCount.objects.create(**validated_data)
        
        has_counted_quantities = False
        
        for item in items_data:
            counted_qty = item.get('counted_quantity')
            if counted_qty is not None:
                has_counted_quantities = True
            
            InventoryCountItem.objects.create(
                count=count,
                product_id=item['product'],
                expected_quantity=item.get('expected_quantity', 0),
                counted_quantity=counted_qty
            )
        
        # Si des quantités comptées sont fournies et auto_validate est True,
        # on valide automatiquement et on met à jour le stock
        if has_counted_quantities and auto_validate:
            count.status = 'COMPLETED'
            count.save()
            
            # Ajuster le stock pour chaque item
            for count_item in count.items.all():
                if count_item.counted_quantity is not None and count_item.difference != 0:
                    # Mettre à jour le stock du produit
                    product = count_item.product
                    old_stock = product.stock
                    product.stock = count_item.counted_quantity
                    product.save()
                    
                    # Créer un mouvement de stock pour tracer l'ajustement
                    diff = count_item.difference
                    StockMovement.objects.create(
                        product=product,
                        movement_type='ADJUSTMENT',
                        quantity=abs(diff),
                        stock_before=old_stock,
                        stock_after=count_item.counted_quantity,
                        notes=f"Ajustement inventaire #{count.id}: {diff:+d}",
                        created_by=self.context['request'].user
                    )
            
            count.status = 'VALIDATED'
            count.completed_at = count.created_at
            count.save()
        
        return count

