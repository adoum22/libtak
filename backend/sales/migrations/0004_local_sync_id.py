from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0003_return_synced_sale_synced_sale_updated_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='sale',
            name='local_sync_id',
            field=models.CharField(
                blank=True, null=True, unique=True, max_length=64,
                help_text='Unique id from origin server, used to dedupe imports',
                verbose_name='Local Sync ID',
            ),
        ),
        migrations.AddField(
            model_name='return',
            name='local_sync_id',
            field=models.CharField(
                blank=True, null=True, unique=True, max_length=64,
                help_text='Unique id from origin server, used to dedupe imports',
                verbose_name='Local Sync ID',
            ),
        ),
    ]
