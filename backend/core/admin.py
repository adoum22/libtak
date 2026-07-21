from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.core.exceptions import PermissionDenied
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

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj and obj.pk == request.user.pk:
            readonly.extend(['role', 'is_active', 'is_staff', 'is_superuser'])
        return readonly

    def has_delete_permission(self, request, obj=None):
        if obj and obj.pk == request.user.pk:
            return False
        if (
            obj
            and obj.role == User.Role.ADMIN
            and obj.is_active
            and not User.objects.filter(
                role=User.Role.ADMIN,
                is_active=True,
            ).exclude(password='').exclude(
                password__startswith='!'
            ).exclude(pk=obj.pk).exists()
        ):
            return False
        return super().has_delete_permission(request, obj)

    def delete_queryset(self, request, queryset):
        if queryset.filter(pk=request.user.pk).exists():
            raise PermissionDenied('Vous ne pouvez pas supprimer votre propre compte.')
        active_admin_ids = set(
            User.objects.filter(role=User.Role.ADMIN, is_active=True)
            .exclude(password='')
            .exclude(password__startswith='!')
            .values_list('pk', flat=True)
        )
        if active_admin_ids and active_admin_ids.issubset(
            set(queryset.values_list('pk', flat=True))
        ):
            raise PermissionDenied('Le dernier administrateur actif doit être conservé.')
        super().delete_queryset(request, queryset)


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ('store_name', 'currency', 'default_tva', 'updated_at')

    def has_add_permission(self, request):
        # Allow only one instance
        return not AppSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
