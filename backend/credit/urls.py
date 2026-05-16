from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CreditSaleViewSet, CustomerViewSet

router = DefaultRouter()
router.register(r'customers', CustomerViewSet)
router.register(r'credits', CreditSaleViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
