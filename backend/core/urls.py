from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView
)
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .views import UserMeView, UserViewSet, AppSettingsView, PublicSettingsView, CustomTokenObtainPairView, DatabaseExportView
from .sync_api import receive_sync_data, get_master_data, sync_status, trigger_sync

router = DefaultRouter()
router.register(r'users', UserViewSet)


@api_view(['GET'])
@permission_classes([AllowAny])
def init_users(request):
    """Create default users if they don't exist - for first-time setup"""
    from django.contrib.auth import get_user_model
    from .models import AppSettings
    
    User = get_user_model()
    results = []
    
    # Create admin
    if not User.objects.filter(username='admin').exists():
        User.objects.create_superuser(
            username='admin',
            email='admin@librairie.com',
            password='admin123',
            role='ADMIN',
            first_name='Admin',
            last_name='Principal'
        )
        results.append("Admin user created")
    else:
        results.append("Admin user already exists")
    
    # Create vendeur
    if not User.objects.filter(username='vendeur').exists():
        User.objects.create_user(
            username='vendeur',
            email='vendeur@librairie.com',
            password='vendeur123',
            role='CASHIER',
            first_name='Mohamed',
            last_name='Vendeur'
        )
        results.append("Vendeur user created")
    else:
        results.append("Vendeur user already exists")
    
    # Init app settings
    try:
        settings = AppSettings.get_settings()
        settings.store_name = "Librairie Attaquaddoum"
        settings.currency = "MAD"
        settings.currency_symbol = "DH"
        settings.save()
        results.append("App settings initialized")
    except Exception as e:
        results.append(f"Settings error: {str(e)}")
    
    return Response({"status": "ok", "results": results})


urlpatterns = [
    # JWT Authentication
    path('login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('verify/', TokenVerifyView.as_view(), name='token_verify'),
    
    # Init users (first-time setup)
    path('init-users/', init_users, name='init_users'),
    
    # Current user
    path('me/', UserMeView.as_view(), name='user_me'),
    
    # Settings
    path('settings/', AppSettingsView.as_view(), name='app_settings'),
    path('settings/public/', PublicSettingsView.as_view(), name='public_settings'),
    
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


