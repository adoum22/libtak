from django.db import migrations, models


def align_legacy_return_states(apps, schema_editor):
    """Legacy returns restored stock as soon as they were created.

    Mark legacy pending rows as approved so the new approval action cannot
    restore the same stock a second time. Completed rows receive their best
    available historical completion timestamp.
    """
    Return = apps.get_model('sales', 'Return')
    Return.objects.filter(status='PENDING').update(
        status='APPROVED',
        stock_restored_at=models.F('updated_at'),
    )
    Return.objects.filter(status='APPROVED', stock_restored_at__isnull=True).update(
        stock_restored_at=models.F('updated_at'),
    )
    Return.objects.filter(status='COMPLETED').update(
        stock_restored_at=models.F('updated_at'),
        completed_at=models.F('updated_at'),
    )


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0006_saleitem_purchase_cost'),
    ]

    operations = [
        migrations.AddField(
            model_name='sale',
            name='amount_received',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10, verbose_name='Amount Received'),
        ),
        migrations.AddField(
            model_name='sale',
            name='change_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10, verbose_name='Change Amount'),
        ),
        migrations.AddField(
            model_name='sale',
            name='idempotency_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64, verbose_name='Idempotency Payload Hash'),
        ),
        migrations.AddField(
            model_name='return',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='return',
            name='idempotency_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64, verbose_name='Idempotency Payload Hash'),
        ),
        migrations.AddField(
            model_name='return',
            name='refund_method',
            field=models.CharField(choices=[('CASH', 'Cash'), ('CARD', 'Card'), ('OTHER', 'Other')], default='CASH', max_length=10, verbose_name='Refund Method'),
        ),
        migrations.AddField(
            model_name='return',
            name='stock_restored_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='returnitem',
            name='restock',
            field=models.BooleanField(default=True, help_text='Disable for damaged or unsellable items.', verbose_name='Return to sellable stock'),
        ),
        migrations.RunPython(align_legacy_return_states, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name='return',
            index=models.Index(fields=['status', 'completed_at'], name='sales_ret_status_done_idx'),
        ),
        migrations.AddIndex(
            model_name='return',
            index=models.Index(fields=['sale', 'status'], name='sales_ret_sale_status_idx'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('total_ht__gte', 0)), name='sale_total_ht_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('total_tva__gte', 0)), name='sale_total_tva_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('total_ttc__gte', 0)), name='sale_total_ttc_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('discount_amount__gte', 0)), name='sale_discount_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('amount_received__gte', 0)), name='sale_amount_received_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='sale',
            constraint=models.CheckConstraint(condition=models.Q(('change_amount__gte', 0)), name='sale_change_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='saleitem',
            constraint=models.CheckConstraint(condition=models.Q(('quantity__gt', 0)), name='sale_item_quantity_positive'),
        ),
        migrations.AddConstraint(
            model_name='return',
            constraint=models.CheckConstraint(condition=models.Q(('refund_amount__gte', 0)), name='return_refund_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='returnitem',
            constraint=models.CheckConstraint(condition=models.Q(('quantity__gt', 0)), name='return_item_quantity_positive'),
        ),
    ]
