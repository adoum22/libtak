from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SaleViewSet, DiscountViewSet, ReturnViewSet, CashRegisterSessionViewSet

router = DefaultRouter()
router.register(r'sales', SaleViewSet)
router.register(r'discounts', DiscountViewSet)
router.register(r'returns', ReturnViewSet)
router.register(r'cash-sessions', CashRegisterSessionViewSet)

urlpatterns = [
    path('', include(router.urls)),
]

