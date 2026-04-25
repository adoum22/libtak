from django.db import migrations, models
from django.utils.translation import gettext_lazy as _


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0004_local_sync_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='sale',
            name='discount_amount',
            field=models.DecimalField(
                _('Discount Amount'),
                decimal_places=2,
                default=0,
                max_digits=10,
            ),
        ),
    ]
