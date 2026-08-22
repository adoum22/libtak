"""JWT authentication for browser WebSocket connections.

Browsers cannot attach an Authorization header to the WebSocket handshake.
The frontend therefore offers the short-lived access token as a non-selected
WebSocket subprotocol (``jwt.<token>``); the server selects only the public
``libtak-stock-v1`` protocol and never echoes the credential.
"""

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


JWT_PROTOCOL_PREFIX = 'jwt.'


@database_sync_to_async
def _authenticate_access_token(raw_token):
    authentication = JWTAuthentication()
    try:
        validated = authentication.get_validated_token(raw_token)
        return authentication.get_user(validated), int(validated.get('exp', 0) or 0)
    except (AuthenticationFailed, InvalidToken, TokenError):
        return AnonymousUser(), 0


class JWTWebSocketAuthMiddleware:
    """Populate ``scope['user']`` from a JWT WebSocket subprotocol."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        scoped = dict(scope)
        token_protocol = next(
            (
                protocol
                for protocol in scoped.get('subprotocols', [])
                if protocol.startswith(JWT_PROTOCOL_PREFIX)
            ),
            None,
        )
        if token_protocol:
            raw_token = token_protocol[len(JWT_PROTOCOL_PREFIX):]
            scoped['user'], scoped['jwt_expires_at'] = await _authenticate_access_token(
                raw_token,
            )
        return await self.app(scoped, receive, send)
