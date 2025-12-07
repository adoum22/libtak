from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView
)
from .views import UserMeView, UserViewSet, AppSettingsView, PublicSettingsView, CustomTokenObtainPairView, DatabaseExportView

router = DefaultRouter()
router.register(r'users', UserViewSet)

urlpatterns = [
    # JWT Authentication
    path('login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('verify/', TokenVerifyView.as_view(), name='token_verify'),
    
    # Current user
    path('me/', UserMeView.as_view(), name='user_me'),
    
    # Settings
    path('settings/', AppSettingsView.as_view(), name='app_settings'),
    path('settings/public/', PublicSettingsView.as_view(), name='public_settings'),
    
    # Database export/backup
    path('backup/', DatabaseExportView.as_view(), name='database_export'),
    
    # User management (admin)
    path('', include(router.urls)),
]
