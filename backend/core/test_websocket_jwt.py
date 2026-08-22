from asgiref.sync import async_to_sync
from channels.auth import AuthMiddlewareStack
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import User
from core.routing import websocket_urlpatterns
from core.websocket_auth import JWTWebSocketAuthMiddleware


def websocket_application():
    return AuthMiddlewareStack(
        JWTWebSocketAuthMiddleware(URLRouter(websocket_urlpatterns)),
    )


class JWTWebSocketAuthenticationTest(TransactionTestCase):
    reset_sequences = True

    def test_valid_access_token_connects_and_selects_public_protocol(self):
        user = User.objects.create_user(
            username='websocket-jwt-user',
            password='Safe-Websocket-Password-2026!',
            role=User.Role.ADMIN,
        )
        access = str(RefreshToken.for_user(user).access_token)

        async def connect():
            communicator = WebsocketCommunicator(
                websocket_application(),
                '/ws/stock/',
                subprotocols=['libtak-stock-v1', f'jwt.{access}'],
            )
            connected, selected_protocol = await communicator.connect()
            if connected:
                await communicator.disconnect()
            return connected, selected_protocol

        connected, selected_protocol = async_to_sync(connect)()
        self.assertTrue(connected)
        self.assertEqual(selected_protocol, 'libtak-stock-v1')

    def test_invalid_access_token_is_rejected(self):
        async def connect():
            communicator = WebsocketCommunicator(
                websocket_application(),
                '/ws/stock/',
                subprotocols=['libtak-stock-v1', 'jwt.not-a-valid-token'],
            )
            connected, close_code = await communicator.connect()
            if connected:
                await communicator.disconnect()
            return connected, close_code

        connected, close_code = async_to_sync(connect)()
        self.assertFalse(connected)
        self.assertEqual(close_code, 4401)
