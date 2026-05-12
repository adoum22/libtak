from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CategoryViewSet, ProductViewSet, SupplierViewSet, StockMovementViewSet,
    PurchaseOrderViewSet, InventoryCountViewSet, ProductCostLayerViewSet,
    update_product_cost_layer,
)

router = DefaultRouter()
router.register(r'categories', CategoryViewSet)
router.register(r'products', ProductViewSet)
router.register(r'product-cost-layers', ProductCostLayerViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'stock-movements', StockMovementViewSet)
router.register(r'purchase-orders', PurchaseOrderViewSet)
router.register(r'counts', InventoryCountViewSet)

urlpatterns = [
    path(
        'products/<int:product_id>/update-cost-layer/',
        update_product_cost_layer,
        name='product-update-cost-layer',
    ),
    path('', include(router.urls)),
]
