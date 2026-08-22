import asyncio
import json
import time
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth import get_user_model


@database_sync_to_async
def _user_can_view_stock(user):
    """Re-read the user so revoked/global permissions apply immediately."""
    if not user or not getattr(user, 'pk', None):
        return False
    current_user = get_user_model().objects.filter(
        pk=user.pk,
        is_active=True,
    ).first()
    return bool(current_user and current_user.effective_can_view_stock)


class StockConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        if not user or not user.is_authenticated or not user.is_active:
            await self.close(code=4401)
            return
        if not await _user_can_view_stock(user):
            await self.close(code=4403)
            return

        self.group_name = 'stock_updates'
        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name
        )
        selected_protocol = (
            'libtak-stock-v1'
            if 'libtak-stock-v1' in self.scope.get('subprotocols', [])
            else None
        )
        await self.accept(subprotocol=selected_protocol)
        expires_at = int(self.scope.get('jwt_expires_at') or 0)
        if expires_at:
            self.token_expiry_task = asyncio.create_task(
                self._close_when_token_expires(expires_at),
            )

    async def _close_when_token_expires(self, expires_at):
        await asyncio.sleep(max(0, expires_at - time.time()))
        await self.close(code=4401)

    async def disconnect(self, close_code):
        expiry_task = getattr(self, 'token_expiry_task', None)
        if expiry_task and expiry_task is not asyncio.current_task():
            expiry_task.cancel()
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name
            )

    async def stock_update(self, event):
        if not await _user_can_view_stock(self.scope.get('user')):
            await self.close(code=4403)
            return
        message = event['message']
        await self.send(text_data=json.dumps({
            'type': 'stock_update',
            'message': message
        }))
