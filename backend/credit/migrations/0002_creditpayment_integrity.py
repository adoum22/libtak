import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('credit', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='creditpayment',
            name='created_by',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='credit_payments_created',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='operation_id',
            field=models.CharField(
                blank=True,
                editable=False,
                max_length=64,
                null=True,
                unique=True,
                verbose_name='Idempotency Key',
            ),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='operation_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='status',
            field=models.CharField(
                choices=[('ACTIVE', 'Actif'), ('REVERSED', 'Contrepassé')],
                default='ACTIVE',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='reversed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='reversal_reason',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='reversal_operation_id',
            field=models.CharField(
                blank=True,
                editable=False,
                max_length=64,
                null=True,
                unique=True,
                verbose_name='Reversal Idempotency Key',
            ),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='reversal_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name='creditpayment',
            name='reversed_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='credit_payments_reversed',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name='creditpayment',
            index=models.Index(
                fields=['status', '-created_at'],
                name='credit_pay_status_idx',
            ),
        ),
        migrations.AddConstraint(
            model_name='creditpayment',
            constraint=models.CheckConstraint(
                condition=models.Q(('amount__gt', 0)),
                name='credit_pay_amount_pos',
            ),
        ),
        migrations.AddConstraint(
            model_name='creditpayment',
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ('operation_id__isnull', True),
                        ('operation_payload_hash', ''),
                    ),
                    models.Q(
                        ('operation_id__isnull', False),
                        models.Q(('operation_payload_hash', ''), _negated=True),
                    ),
                    _connector='OR',
                ),
                name='credit_pay_operation_meta',
            ),
        ),
        migrations.AddConstraint(
            model_name='creditpayment',
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ('reversal_operation_id__isnull', True),
                        ('reversal_payload_hash', ''),
                        ('reversal_reason', ''),
                        ('reversed_at__isnull', True),
                        ('reversed_by__isnull', True),
                        ('status', 'ACTIVE'),
                    ),
                    models.Q(
                        ('reversal_operation_id__isnull', False),
                        ('reversed_at__isnull', False),
                        ('status', 'REVERSED'),
                        models.Q(('reversal_reason', ''), _negated=True),
                        models.Q(('reversal_payload_hash', ''), _negated=True),
                    ),
                    _connector='OR',
                ),
                name='credit_pay_reversal_meta',
            ),
        ),
    ]
