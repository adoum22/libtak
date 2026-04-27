# Generated to repair legacy products with NULL stock / min_stock /
# purchase_price / sale_price_ht / tva. These NULL values would crash
# Product.is_low_stock (`int <= None` -> TypeError) and break the entire
# /inventory/products/ endpoint -> "Erreur de chargement" on every page
# that lists products (Stock, Caisse, etc.).

from decimal import Decimal
from django.db import migrations


def normalize_nulls(apps, schema_editor):
    Product = apps.get_model('inventory', 'Product')
    fixed = 0
    for product in Product.objects.all():
        changed = False
        if product.stock is None:
            product.stock = 0
            changed = True
        if product.min_stock is None:
            product.min_stock = 5
            changed = True
        if product.purchase_price is None:
            product.purchase_price = Decimal('0')
            changed = True
        if product.sale_price_ht is None:
            product.sale_price_ht = Decimal('0')
            changed = True
        if product.tva is None:
            product.tva = Decimal('20')
            changed = True
        if changed:
            product.save(update_fields=[
                'stock', 'min_stock', 'purchase_price', 'sale_price_ht', 'tva',
            ])
            fixed += 1
    print(f"  → normalized {fixed} product(s) with NULL fields")


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0006_productcostlayer'),
    ]

    operations = [
        migrations.RunPython(normalize_nulls, migrations.RunPython.noop),
    ]
