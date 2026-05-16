from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0006_saleitem_purchase_cost'),
    ]

    operations = [
        migrations.AlterField(
            model_name='sale',
            name='payment_method',
            field=models.CharField(
                choices=[
                    ('CASH', 'Cash'),
                    ('CARD', 'Card'),
                    ('CREDIT', 'Credit'),
                    ('OTHER', 'Other'),
                ],
                default='CASH',
                max_length=10,
            ),
        ),
    ]
