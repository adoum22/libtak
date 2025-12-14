from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CategoryViewSet, ProductViewSet, SupplierViewSet, StockMovementViewSet,
    PurchaseOrderViewSet, InventoryCountViewSet
)

router = DefaultRouter()
router.register(r'categories', CategoryViewSet)
router.register(r'products', ProductViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'stock-movements', StockMovementViewSet)
router.register(r'purchase-orders', PurchaseOrderViewSet)
router.register(r'counts', InventoryCountViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
