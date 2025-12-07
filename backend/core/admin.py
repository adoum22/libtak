from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, AppSettings


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('username', 'email', 'role', 'first_name', 'last_name', 'is_active', 'is_staff')
    list_filter = ('role', 'is_active', 'is_staff', 'is_superuser')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    ordering = ('username',)
    
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Rôle et Contact', {
            'fields': ('role', 'phone', 'avatar')
        }),
    )
    
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Rôle', {
            'fields': ('role',)
        }),
    )


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ('store_name', 'currency', 'default_tva', 'updated_at')
    
    def has_add_permission(self, request):
        # Allow only one instance
        return not AppSettings.objects.exists()
    
    def has_delete_permission(self, request, obj=None):
        return False
