from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0008_fix_fully_received_purchase_orders'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchaseorderitem',
            name='sale_price',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text='Public sale price to apply when receiving this order',
                max_digits=10,
                null=True,
                verbose_name='Sale Price',
            ),
        ),
    ]
