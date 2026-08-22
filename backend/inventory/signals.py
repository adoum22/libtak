from django.db import transaction
import logging

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from .models import Product, ProductCostLayer, StockMovement, Supplier

logger = logging.getLogger(__name__)


@receiver(post_save, sender=StockMovement)
def broadcast_stock_movement(sender, instance, created, **kwargs):
    """Publish every audited stock change after its DB transaction commits."""
    if not created:
        return

    def publish():
        try:
            from asgiref.sync import async_to_sync
            from channels.layers import get_channel_layer

            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    'stock_updates',
                    {
                        'type': 'stock_update',
                        'message': {
                            'product_id': instance.product_id,
                            'new_stock': instance.stock_after,
                            'movement_id': instance.pk,
                        },
                    },
                )
        except Exception:
            # A transient realtime failure must never roll back stock.
            logger.exception('Unable to broadcast stock movement %s', instance.pk)

    transaction.on_commit(publish, robust=True)


@receiver(pre_save, sender=Product)
def remember_sale_price_change(sender, instance, update_fields=None, **kwargs):
    """Remember whether the product-wide selling price is changing.

    FIFO layers retain their acquisition cost, but every active unit must use
    the same current selling price.  The flag lets the post-save receiver keep
    legacy layer snapshots aligned for every save path (API, import, sync and
    Django admin).
    """
    instance.__dict__.pop('_inventory_sale_price_changed', None)
    if not instance.pk:
        return
    if update_fields is not None and 'sale_price_ht' not in update_fields:
        return
    try:
        previous_price = sender.objects.values_list(
            'sale_price_ht', flat=True,
        ).get(pk=instance.pk)
    except sender.DoesNotExist:
        return
    instance._inventory_sale_price_changed = previous_price != instance.sale_price_ht


@receiver(post_save, sender=Product)
def propagate_current_sale_price(sender, instance, **kwargs):
    """Apply the current product selling price to every unsold FIFO unit."""
    changed = instance.__dict__.pop('_inventory_sale_price_changed', False)
    if not changed:
        return
    ProductCostLayer.objects.filter(
        product_id=instance.pk,
        remaining_quantity__gt=0,
    ).exclude(sale_price=instance.sale_price_ht).update(
        sale_price=instance.sale_price_ht,
    )


def _delete_after_commit(storage, name):
    if name:
        def delete_file():
            try:
                storage.delete(name)
            except Exception:
                logger.exception('Unable to delete replaced image %s', name)

        transaction.on_commit(delete_file, robust=True)


def _cleanup_replaced_image(sender, instance, update_fields=None, **kwargs):
    instance.__dict__.pop('_inventory_old_image', None)
    if not instance.pk:
        return
    if update_fields is not None and 'image' not in update_fields:
        return
    try:
        previous = sender.objects.only('image').get(pk=instance.pk)
    except sender.DoesNotExist:
        return
    old_image = previous.image
    new_name = getattr(instance.image, 'name', '')
    if old_image and old_image.name != new_name:
        instance._inventory_old_image = (old_image.storage, old_image.name)


@receiver(pre_save, sender=Product)
@receiver(pre_save, sender=Supplier)
def cleanup_replaced_image(sender, instance, update_fields=None, **kwargs):
    _cleanup_replaced_image(sender, instance, update_fields=update_fields)


@receiver(post_save, sender=Product)
@receiver(post_save, sender=Supplier)
def delete_replaced_image_after_save(sender, instance, **kwargs):
    old_image = getattr(instance, '_inventory_old_image', None)
    if not old_image:
        return
    del instance._inventory_old_image
    _delete_after_commit(*old_image)


@receiver(post_delete, sender=Product)
@receiver(post_delete, sender=Supplier)
def cleanup_deleted_image(sender, instance, **kwargs):
    image = instance.image
    if image:
        _delete_after_commit(image.storage, image.name)
