from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounting', '0004_cashregisteradjustment'),
    ]

    operations = [
        migrations.AddField(
            model_name='expense',
            name='paid_from_cash',
            field=models.BooleanField(
                default=True,
                help_text='Si oui, cette depense est soustraite de la caisse physique.',
                verbose_name='Paid From Cash Register',
            ),
        ),
    ]
