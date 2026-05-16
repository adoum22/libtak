from django.contrib import admin

from .models import CreditPayment, CreditSale, Customer


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('name', 'phone', 'created_at')
    search_fields = ('name', 'phone')


@admin.register(CreditSale)
class CreditSaleAdmin(admin.ModelAdmin):
    list_display = ('id', 'customer', 'status', 'paid_amount', 'created_at')
    list_filter = ('status',)
    search_fields = ('customer__name',)
    # paid_amount et status sont pilotés par l'endpoint /pay/ : on bloque
    # l'édition manuelle pour ne pas casser l'invariant paid_amount <= total_ttc.
    readonly_fields = (
        'sale', 'customer', 'paid_amount', 'status',
        'created_at', 'updated_at',
    )


@admin.register(CreditPayment)
class CreditPaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'credit_sale', 'amount', 'created_by', 'created_at')
    search_fields = ('credit_sale__customer__name',)
    readonly_fields = ('credit_sale', 'amount', 'note', 'created_by', 'created_at')
