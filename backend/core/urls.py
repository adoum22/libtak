from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenRefreshView,
    TokenVerifyView,
)
from .views import (
    UserMeView,
    UserViewSet,
    AppSettingsView,
    AppSettingsLogoView,
    PublicSettingsView,
    CustomTokenObtainPairView,
    DatabaseExportView,
    LogoutView,
    ChangePasswordView,
    AuditLogViewSet,
    AppVersionView,
)
from .sync_api import receive_sync_data, get_master_data, sync_status, trigger_sync

router = DefaultRouter()
router.register(r'users', UserViewSet)
router.register(r'audit-logs', AuditLogViewSet, basename='audit-logs')


urlpatterns = [
    # JWT Authentication
    path('login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('logout/', LogoutView.as_view(), name='logout'),

    # Current user
    path('me/', UserMeView.as_view(), name='user_me'),
    path('me/change-password/', ChangePasswordView.as_view(), name='change_password'),

    # Settings
    path('settings/', AppSettingsView.as_view(), name='app_settings'),
    path('settings/public/', PublicSettingsView.as_view(), name='public_settings'),
    path('settings/logo/', AppSettingsLogoView.as_view(), name='app_settings_logo'),
    path('version/', AppVersionView.as_view(), name='app_version'),

    # Database export/backup
    path('backup/', DatabaseExportView.as_view(), name='database_export'),

    # Sync API (for local-to-cloud synchronization)
    path('sync/receive/', receive_sync_data, name='sync_receive'),
    path('sync/master-data/', get_master_data, name='sync_master_data'),
    path('sync/status/', sync_status, name='sync_status'),
    path('sync/trigger/', trigger_sync, name='sync_trigger'),

    # User management (admin)
    path('', include(router.urls)),
]
