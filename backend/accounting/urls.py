from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    ExpenseCategoryViewSet,
    MonthlyAccountingViewSet,
    ExpenseViewSet,
    CashRegisterView,
    CashierExpenseView,
    PeriodSummaryView,
    YearSummaryView,
)

router = DefaultRouter()
router.register(r'categories', ExpenseCategoryViewSet, basename='accounting-categories')
router.register(r'monthly', MonthlyAccountingViewSet, basename='accounting-monthly')
router.register(r'expenses', ExpenseViewSet, basename='accounting-expenses')

urlpatterns = [
    path('summary/', YearSummaryView.as_view(), name='accounting-year-summary'),
    path('period-summary/', PeriodSummaryView.as_view(), name='accounting-period-summary'),
    path('cash-register/', CashRegisterView.as_view(), name='accounting-cash-register'),
    path('cashier-expense/', CashierExpenseView.as_view(), name='accounting-cashier-expense'),
    path('', include(router.urls)),
]
