import os
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_app = get_asgi_application()

# Import channels only after Django setup.
# Channels is a required dependency; silently falling back would make a broken
# real-time deployment look healthy.
from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator

import core.routing
from core.websocket_auth import JWTWebSocketAuthMiddleware


application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": OriginValidator(
        AuthMiddlewareStack(
            JWTWebSocketAuthMiddleware(
                URLRouter(
                    core.routing.websocket_urlpatterns
                )
            )
        ),
        list(dict.fromkeys([
            *settings.CORS_ALLOWED_ORIGINS,
            *settings.CSRF_TRUSTED_ORIGINS,
        ])),
    ),
})

