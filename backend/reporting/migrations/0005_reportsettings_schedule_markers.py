from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('reporting', '0004_reportlog_backup_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='reportsettings',
            name='daily_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='reportsettings',
            name='low_stock_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='reportsettings',
            name='monthly_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='reportsettings',
            name='quarterly_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='reportsettings',
            name='weekly_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='reportsettings',
            name='yearly_last_sent_on',
            field=models.DateField(blank=True, editable=False, null=True),
        ),
    ]
