from django.contrib import admin
from .models import Category, Product, Supplier, StockMovement


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'description', 'icon', 'color')
    search_fields = ('name',)


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ('name', 'contact_name', 'email', 'phone', 'active', 'created_at')
    list_filter = ('active',)
    search_fields = ('name', 'contact_name', 'email')
    ordering = ('name',)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name', 'barcode', 'category', 'supplier', 'purchase_price', 'sale_price_ht', 'stock', 'is_low_stock', 'active')
    list_filter = ('category', 'supplier', 'active')
    search_fields = ('name', 'barcode', 'description')
    ordering = ('name',)
    readonly_fields = ('price_ttc', 'profit_margin', 'profit_percentage', 'stock_value')
    
    fieldsets = (
        ('Informations Générales', {
            'fields': ('name', 'barcode', 'description', 'image', 'active')
        }),
        ('Prix', {
            'fields': ('purchase_price', 'sale_price_ht', 'tva', 'price_ttc', 'profit_margin', 'profit_percentage')
        }),
        ('Stock', {
            'fields': ('stock', 'min_stock', 'stock_value')
        }),
        ('Relations', {
            'fields': ('category', 'supplier')
        }),
    )


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ('product', 'movement_type', 'quantity', 'stock_before', 'stock_after', 'supplier', 'created_by', 'created_at')
    list_filter = ('movement_type', 'supplier', 'created_at')
    search_fields = ('product__name', 'product__barcode', 'reference')
    ordering = ('-created_at',)
    readonly_fields = ('stock_before', 'stock_after', 'created_at')
    
    def has_change_permission(self, request, obj=None):
        return False  # Stock movements shouldn't be modified
