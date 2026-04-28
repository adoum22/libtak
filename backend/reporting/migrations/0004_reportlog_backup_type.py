from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reporting', '0003_drop_smtp_fields'),
    ]

    operations = [
        migrations.AlterField(
            model_name='reportlog',
            name='report_type',
            field=models.CharField(
                choices=[
                    ('DAILY', 'Daily'),
                    ('WEEKLY', 'Weekly'),
                    ('MONTHLY', 'Monthly'),
                    ('QUARTERLY', 'Quarterly'),
                    ('YEARLY', 'Yearly'),
                    ('BACKUP', 'Backup'),
                ],
                max_length=20,
                verbose_name='Report Type',
            ),
        ),
    ]
