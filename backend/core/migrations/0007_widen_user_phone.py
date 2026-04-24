from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_synclog'),
    ]

    operations = [
        migrations.AlterField(
            model_name='user',
            name='phone',
            field=models.CharField(blank=True, max_length=30, verbose_name='Phone'),
        ),
    ]
