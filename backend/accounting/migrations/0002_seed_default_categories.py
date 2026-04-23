from django.db import migrations


DEFAULT_CATEGORIES = [
    'Vendeuse',
    'Internet',
    'Électricité',
    'Taxe',
    'Comptable',
    'Dépenses quotidiennes',
]


def seed(apps, schema_editor):
    ExpenseCategory = apps.get_model('accounting', 'ExpenseCategory')
    for name in DEFAULT_CATEGORIES:
        ExpenseCategory.objects.get_or_create(
            name=name, defaults={'is_default': True}
        )


def unseed(apps, schema_editor):
    ExpenseCategory = apps.get_model('accounting', 'ExpenseCategory')
    ExpenseCategory.objects.filter(name__in=DEFAULT_CATEGORIES, is_default=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('accounting', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
