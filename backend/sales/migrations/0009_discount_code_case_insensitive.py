from django.db import migrations, models
from django.db.models.functions import Lower


MAX_CODE_LENGTH = 50


def _duplicate_code(base, pk, counter):
    suffix = f'-DUP-{pk}' if counter == 0 else f'-DUP-{pk}-{counter}'
    prefix = base[:MAX_CODE_LENGTH - len(suffix)]
    return f'{prefix}{suffix}'


def normalize_existing_codes(apps, schema_editor):
    """Normalize legacy codes without dropping an already-used promotion.

    If legacy rows differ only by case/whitespace, the active and most-used row
    keeps the public code. Other rows are retained for audit, renamed with a
    deterministic suffix, and disabled so checkout can never choose between
    two historical definitions.
    """
    Discount = apps.get_model('sales', 'Discount')
    rows = list(Discount.objects.exclude(code__isnull=True).values(
        'id', 'code', 'active', 'uses_count',
    ))
    if not rows:
        return

    # Temporarily clearing the nullable unique field avoids collisions while
    # e.g. ``promo`` and ``PROMO`` swap into their canonical representation.
    Discount.objects.filter(id__in=[row['id'] for row in rows]).update(code=None)

    groups = {}
    for row in rows:
        normalized = str(row['code'] or '').strip().upper()
        if normalized:
            groups.setdefault(normalized, []).append(row)

    reserved = set(groups)
    used = set(reserved)
    assignments = []
    for base in sorted(groups):
        members = sorted(
            groups[base],
            key=lambda row: (
                not bool(row['active']),
                -int(row['uses_count'] or 0),
                row['id'],
            ),
        )
        assignments.append((members[0]['id'], base, bool(members[0]['active'])))
        for row in members[1:]:
            counter = 0
            candidate = _duplicate_code(base, row['id'], counter)
            while candidate in used:
                counter += 1
                candidate = _duplicate_code(base, row['id'], counter)
            used.add(candidate)
            assignments.append((row['id'], candidate, False))

    for pk, code, active in assignments:
        Discount.objects.filter(pk=pk).update(code=code, active=active)


class Migration(migrations.Migration):

    dependencies = [
        ('sales', '0008_discount_constraints'),
    ]

    operations = [
        migrations.RunPython(normalize_existing_codes, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='discount',
            constraint=models.UniqueConstraint(
                Lower('code'),
                condition=models.Q(code__isnull=False),
                name='sales_discount_code_ci_unique',
            ),
        ),
    ]
