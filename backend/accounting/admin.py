from django.contrib import admin
from .models import CashRegisterAdjustment, ExpenseCategory, MonthlyAccounting, Expense


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_default', 'created_at')
    list_filter = ('is_default',)
    search_fields = ('name',)


class ExpenseInline(admin.TabularInline):
    model = Expense
    extra = 0
    autocomplete_fields = ('category',)


@admin.register(MonthlyAccounting)
class MonthlyAccountingAdmin(admin.ModelAdmin):
    list_display = ('year', 'month', 'manager_withdrawal', 'updated_at')
    list_filter = ('year', 'month')
    search_fields = ('year', 'month', 'notes')
    inlines = [ExpenseInline]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('category', 'amount', 'paid_from_cash', 'monthly', 'incurred_on', 'created_at')
    list_filter = ('category', 'paid_from_cash', 'monthly__year', 'monthly__month')
    search_fields = ('description',)
    autocomplete_fields = ('category', 'monthly')


@admin.register(CashRegisterAdjustment)
class CashRegisterAdjustmentAdmin(admin.ModelAdmin):
    list_display = ('adjustment_type', 'amount', 'counted_amount', 'created_by', 'created_at')
    list_filter = ('adjustment_type', 'created_at')
    search_fields = ('note', 'created_by__username')
    autocomplete_fields = ('created_by',)
