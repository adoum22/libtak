from django.db import migrations, models


def seed_layer_sale_prices(apps, schema_editor):
    ProductCostLayer = apps.get_model('inventory', 'ProductCostLayer')
    for layer in ProductCostLayer.objects.select_related('product').filter(
        sale_price__isnull=True,
    ).iterator():
        layer.sale_price = layer.product.sale_price_ht
        layer.save(update_fields=['sale_price'])


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0009_purchaseorderitem_sale_price'),
    ]

    operations = [
        migrations.AddField(
            model_name='productcostlayer',
            name='sale_price',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                verbose_name='Sale Price',
            ),
        ),
        migrations.AddField(
            model_name='stockmovement',
            name='sale_price',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Sale price for this stock lot',
                max_digits=10,
                null=True,
                verbose_name='Sale Price',
            ),
        ),
        migrations.RunPython(seed_layer_sale_prices, migrations.RunPython.noop),
    ]
