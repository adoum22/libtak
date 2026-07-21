from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0009_discount_code_case_insensitive'),
    ]

    operations = [
        migrations.AddField(
            model_name='sale',
            name='discount_code',
            field=models.CharField(
                blank=True,
                default='',
                help_text='Immutable snapshot of the promotion code used for this sale.',
                max_length=50,
                verbose_name='Applied Discount Code',
            ),
        ),
    ]
