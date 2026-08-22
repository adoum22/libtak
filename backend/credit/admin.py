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

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(CreditPayment)
class CreditPaymentAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'credit_sale', 'amount', 'status', 'created_by', 'created_at',
    )
    list_filter = ('status',)
    search_fields = ('credit_sale__customer__name',)
    readonly_fields = (
        'credit_sale',
        'amount',
        'note',
        'created_by',
        'operation_id',
        'operation_payload_hash',
        'status',
        'reversed_by',
        'reversed_at',
        'reversal_reason',
        'reversal_operation_id',
        'reversal_payload_hash',
        'created_at',
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
