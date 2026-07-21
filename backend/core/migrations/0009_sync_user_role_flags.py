import core.models
from django.contrib.auth.hashers import check_password, make_password
from django.db import migrations


def synchronize_role_flags(apps, schema_editor):
    User = apps.get_model('core', 'User')

    # Preserve existing superusers by making their application role explicit.
    User.objects.filter(is_superuser=True).update(role='ADMIN', is_staff=True)
    User.objects.filter(role='ADMIN').update(is_staff=True)
    User.objects.exclude(role='ADMIN').update(is_staff=False, is_superuser=False)

    # Invalidate only the two credentials created by historical bootstrap
    # scripts. Changing the password hash also invalidates CHECK_REVOKE_TOKEN
    # JWTs. The deployment bootstrap must provide a new administrator secret.
    legacy_credentials = {
        'admin': 'admin' + '123',
        'vendeur': 'vendeur' + '123',
    }
    for username, legacy_password in legacy_credentials.items():
        user = User.objects.filter(username=username).first()
        if user and check_password(legacy_password, user.password):
            user.password = make_password(None)
            if username == 'vendeur':
                user.is_active = False
            user.save(update_fields=['password', 'is_active'])


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0008_appsettings_invoice_fields'),
    ]

    operations = [
        migrations.RunPython(synchronize_role_flags, migrations.RunPython.noop),
        migrations.AlterModelManagers(
            name='user',
            managers=[
                ('objects', core.models.UserManager()),
            ],
        ),
    ]
