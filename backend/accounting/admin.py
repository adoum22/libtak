from django.contrib import admin
from .models import ExpenseCategory, MonthlyAccounting, Expense


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
    inlines = [ExpenseInline]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ('category', 'amount', 'monthly', 'incurred_on', 'created_at')
    list_filter = ('category', 'monthly__year', 'monthly__month')
    search_fields = ('description',)
    autocomplete_fields = ('category', 'monthly')
