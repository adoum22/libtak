from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db.models import Sum

from .models import Sale


def revenue_for_month(year: int, month: int) -> Decimal:
    """Total TTC revenue for a given calendar month.

    Single source of truth for monthly revenue used by the accounting
    and reporting modules. Reports may further deduct returns or COGS;
    this returns gross sales TTC only.
    """
    last_day = monthrange(year, month)[1]
    qs = Sale.objects.filter(
        created_at__date__gte=date(year, month, 1),
        created_at__date__lte=date(year, month, last_day),
    )
    return qs.aggregate(total=Sum('total_ttc'))['total'] or Decimal('0')
