import json
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
        await self.accept()

    async def disconnect(self, close_code):
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
