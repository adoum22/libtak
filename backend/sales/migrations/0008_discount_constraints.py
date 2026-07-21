from decimal import Decimal

from django.db import migrations, models


def normalize_discounts(apps, schema_editor):
    Discount = apps.get_model('sales', 'Discount')
    Discount.objects.filter(value__lte=0).update(
        value=Decimal('0.01'),
        active=False,
    )
    Discount.objects.filter(
        discount_type='PERCENTAGE', value__gt=100,
    ).update(value=Decimal('100.00'))
    Discount.objects.filter(min_purchase__lt=0).update(min_purchase=0)
    Discount.objects.filter(max_uses__lt=0).update(max_uses=0)
    Discount.objects.filter(uses_count__lt=0).update(uses_count=0)


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0007_harden_sales_and_returns'),
    ]

    operations = [
        migrations.RunPython(normalize_discounts, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.CheckConstraint(
                condition=models.Q(('value__gt', 0)),
                name='discount_value_positive',
            ),
        ),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.CheckConstraint(
                condition=models.Q(('min_purchase__gte', 0)),
                name='discount_min_purchase_nonnegative',
            ),
        ),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.CheckConstraint(
                condition=models.Q(('max_uses__gte', 0)),
                name='discount_max_uses_nonnegative',
            ),
        ),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.CheckConstraint(
                condition=models.Q(('uses_count__gte', 0)),
                name='discount_uses_count_nonnegative',
            ),
        ),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.CheckConstraint(
                condition=(
                    ~models.Q(('discount_type', 'PERCENTAGE'))
                    | models.Q(('value__lte', 100))
                ),
                name='discount_percentage_lte_100',
            ),
        ),
    ]
