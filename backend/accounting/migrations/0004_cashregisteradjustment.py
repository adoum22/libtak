from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('accounting', '0003_rename_accounting__monthly_cat_idx_accounting__monthly_add847_idx_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='CashRegisterAdjustment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('adjustment_type', models.CharField(choices=[('OPENING', 'Opening float'), ('COUNT', 'Physical count'), ('MANUAL', 'Manual adjustment')], default='MANUAL', max_length=20, verbose_name='Adjustment Type')),
                ('amount', models.DecimalField(decimal_places=2, help_text='Montant signe ajoute au solde de caisse', max_digits=12, verbose_name='Amount')),
                ('counted_amount', models.DecimalField(blank=True, decimal_places=2, help_text='Montant reel compte en caisse, si applicable', max_digits=12, null=True, verbose_name='Counted Amount')),
                ('note', models.CharField(blank=True, max_length=255, verbose_name='Note')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='cash_register_adjustments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Cash Register Adjustment',
                'verbose_name_plural': 'Cash Register Adjustments',
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['adjustment_type', 'created_at'], name='accounting__adjustm_f8a208_idx')],
            },
        ),
    ]
