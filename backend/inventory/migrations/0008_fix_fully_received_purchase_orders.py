from django.db import migrations
from django.db.models import F


def mark_fully_received_orders(apps, schema_editor):
    PurchaseOrder = apps.get_model('inventory', 'PurchaseOrder')
    PurchaseOrderItem = apps.get_model('inventory', 'PurchaseOrderItem')

    stuck_order_ids = (
        PurchaseOrder.objects
        .filter(status='PARTIAL')
        .exclude(
            id__in=PurchaseOrderItem.objects
            .filter(received_quantity__lt=F('quantity'))
            .values('order_id')
        )
        .values_list('id', flat=True)
    )
    PurchaseOrder.objects.filter(id__in=stuck_order_ids).update(status='RECEIVED')


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0007_normalize_product_nulls'),
    ]

    operations = [
        migrations.RunPython(mark_fully_received_orders, migrations.RunPython.noop),
    ]
