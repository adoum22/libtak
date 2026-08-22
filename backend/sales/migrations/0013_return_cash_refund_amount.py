from django.db import migrations, models
from django.db.models import F


def backfill_cash_refunds(apps, schema_editor):
    Return = apps.get_model('sales', 'Return')
    Return.objects.filter(
        status='COMPLETED',
        refund_method='CASH',
    ).update(cash_refund_amount=F('refund_amount'))


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0012_alter_return_refund_method'),
    ]

    operations = [
        migrations.AddField(
            model_name='return',
            name='cash_refund_amount',
            field=models.DecimalField(
                decimal_places=2,
                default=0,
                help_text=(
                    'Montant réellement rendu en espèces. Pour un crédit, la part '
                    'qui annule seulement la dette reste exclue.'
                ),
                max_digits=10,
                verbose_name='Cash Refund Amount',
            ),
        ),
        migrations.RunPython(
            backfill_cash_refunds,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name='return',
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ('cash_refund_amount__gte', 0),
                    ('cash_refund_amount__lte', F('refund_amount')),
                ),
                name='return_cash_refund_valid',
            ),
        ),
    ]
