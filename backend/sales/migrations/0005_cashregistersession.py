from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0004_add_local_id_for_sync_deduplication'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='CashRegisterSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('opening_amount', models.DecimalField(decimal_places=2, help_text='Cash in the drawer at session open', max_digits=10, verbose_name='Opening Amount')),
                ('actual_declared_amount', models.DecimalField(blank=True, decimal_places=2, help_text='Cash counted in the drawer at session close', max_digits=10, null=True, verbose_name='Actual Declared Amount')),
                ('variance', models.DecimalField(blank=True, decimal_places=2, help_text='actual_declared_amount − theoretical_closing_amount (negative = shortage)', max_digits=10, null=True, verbose_name='Variance')),
                ('opened_at', models.DateTimeField(auto_now_add=True, verbose_name='Opened At')),
                ('closed_at', models.DateTimeField(blank=True, null=True, verbose_name='Closed At')),
                ('status', models.CharField(choices=[('OPEN', 'Open'), ('CLOSED', 'Closed')], db_index=True, default='OPEN', max_length=10, verbose_name='Status')),
                ('notes', models.TextField(blank=True, verbose_name='Notes')),
                ('opened_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='opened_cash_sessions', to=settings.AUTH_USER_MODEL)),
                ('closed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='closed_cash_sessions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Cash Register Session',
                'verbose_name_plural': 'Cash Register Sessions',
                'ordering': ['-opened_at'],
            },
        ),
    ]
