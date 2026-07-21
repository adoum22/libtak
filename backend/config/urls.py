from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.authentication import BasicAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework_simplejwt.authentication import JWTAuthentication

from core.permissions import IsAdminRole


def health_check(request):
    return JsonResponse({'status': 'healthy', 'message': 'Libtak API is running'})


urlpatterns = [
    path('api/health/', health_check, name='health-check'),
    path('api/auth/', include('core.urls')),
    path('api/inventory/', include('inventory.urls')),
    path('api/sales/', include('sales.urls')),
    path('api/reporting/', include('reporting.urls')),
    path('api/accounting/', include('accounting.urls')),
    path('api/credit/', include('credit.urls')),
]

if settings.ENABLE_DJANGO_ADMIN:
    urlpatterns += [path('admin/', admin.site.urls)]

if settings.ENABLE_API_DOCS:
    urlpatterns += [
        path(
            'api/schema/',
            SpectacularAPIView.as_view(
                authentication_classes=[BasicAuthentication, JWTAuthentication],
                permission_classes=[IsAuthenticated, IsAdminRole]
            ),
            name='schema',
        ),
        path(
            'api/docs/',
            SpectacularSwaggerView.as_view(
                url_name='schema',
                authentication_classes=[BasicAuthentication, JWTAuthentication],
                permission_classes=[IsAuthenticated, IsAdminRole],
            ),
            name='swagger-ui',
        ),
    ]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
