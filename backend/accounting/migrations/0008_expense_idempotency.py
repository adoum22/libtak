from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounting', '0007_expense_created_by'),
    ]

    operations = [
        migrations.AddField(
            model_name='expense',
            name='operation_id',
            field=models.UUIDField(
                blank=True,
                editable=False,
                help_text='Client idempotency key for expense creation.',
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name='expense',
            name='operation_payload_hash',
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
    ]
