import os
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_app = get_asgi_application()

# Import channels only after Django setup
try:
    from channels.routing import ProtocolTypeRouter, URLRouter
    from channels.auth import AuthMiddlewareStack
    from channels.security.websocket import AllowedHostsOriginValidator
    import core.routing

    application = ProtocolTypeRouter({
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(
                URLRouter(
                    core.routing.websocket_urlpatterns
                )
            )
        ),
    })
except Exception as e:
    # Fallback for development without channels setup
    print(f"Warning: Channels not configured properly ({e}), using simple ASGI")
    application = django_asgi_app

