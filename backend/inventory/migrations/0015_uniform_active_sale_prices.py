from django.db import migrations


def align_active_sale_prices(apps, schema_editor):
    Product = apps.get_model('inventory', 'Product')
    ProductCostLayer = apps.get_model('inventory', 'ProductCostLayer')

    for product_id, sale_price in Product.objects.values_list(
        'id', 'sale_price_ht',
    ).iterator():
        ProductCostLayer.objects.filter(
            product_id=product_id,
            remaining_quantity__gt=0,
        ).exclude(sale_price=sale_price).update(sale_price=sale_price)


class Migration(migrations.Migration):
    dependencies = [
        ('inventory', '0014_actual_received_costs'),
    ]

    operations = [
        migrations.RunPython(
            align_active_sale_prices,
            migrations.RunPython.noop,
        ),
    ]
