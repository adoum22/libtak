from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('reporting', '0002_reportsettings_sender_email_and_more'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='reportsettings',
            name='sender_email',
        ),
        migrations.RemoveField(
            model_name='reportsettings',
            name='sender_password',
        ),
        migrations.RemoveField(
            model_name='reportsettings',
            name='smtp_host',
        ),
        migrations.RemoveField(
            model_name='reportsettings',
            name='smtp_port',
        ),
    ]
