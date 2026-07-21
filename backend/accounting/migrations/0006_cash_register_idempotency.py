from django.db import migrations, models


def create_register_state(apps, schema_editor):
    CashRegisterState = apps.get_model('accounting', 'CashRegisterState')
    CashRegisterState.objects.get_or_create(pk=1)


class Migration(migrations.Migration):

    dependencies = [
        ('accounting', '0005_expense_paid_from_cash'),
    ]

    operations = [
        migrations.AddField(
            model_name='cashregisteradjustment',
            name='operation_id',
            field=models.UUIDField(
                blank=True,
                editable=False,
                help_text='Client idempotency key for register operations',
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='cashregisteradjustment',
            name='operation_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.CreateModel(
            name='CashRegisterState',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Cash register state',
                'verbose_name_plural': 'Cash register state',
            },
        ),
        migrations.RunPython(create_register_state, migrations.RunPython.noop),
    ]
