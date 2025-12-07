from rest_framework import serializers
from .models import Category, Product, Supplier, StockMovement


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
