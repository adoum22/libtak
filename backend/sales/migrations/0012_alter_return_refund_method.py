from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0011_merge_credit_and_hardening'),
    ]

    operations = [
        migrations.AlterField(
            model_name='return',
            name='refund_method',
            field=models.CharField(
                choices=[
                    ('CASH', 'Cash'),
                    ('CARD', 'Card'),
                    ('CREDIT', 'Credit'),
                    ('OTHER', 'Other'),
                ],
                default='CASH',
                max_length=10,
                verbose_name='Refund Method',
            ),
        ),
    ]
