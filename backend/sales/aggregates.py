from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db.models import Sum, F

from .models import Sale, SaleItem


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


def gross_margin_for_period(start_date, end_date) -> Decimal:
    """Marge brute pour une période = Σ (prix_vente_HT - prix_achat) × quantité.

    Source unique pour le calcul du bénéfice avant déduction des dépenses
    d'exploitation. Utilisée par accounting et reporting pour garantir la
    cohérence du chiffre.
    """
    items = SaleItem.objects.filter(
        sale__created_at__date__gte=start_date,
        sale__created_at__date__lte=end_date,
    )
    agg = items.aggregate(
        revenue=Sum(F('unit_price_ht') * F('quantity')),
        cost=Sum(F('quantity') * F('product__purchase_price')),
    )
    discounts = Sale.objects.filter(
        created_at__date__gte=start_date,
        created_at__date__lte=end_date,
    ).aggregate(total=Sum('discount_amount'))['total'] or Decimal('0')
    return (
        (agg['revenue'] or Decimal('0'))
        - (agg['cost'] or Decimal('0'))
        - discounts
    )


def operating_expenses_for_period(start_date, end_date) -> Decimal:
    """Total des dépenses d'exploitation rattachées à la période.

    On utilise la date `incurred_on` de chaque dépense quand elle existe ;
    sinon on rattache la dépense au mois (year/month) de son MonthlyAccounting
    parent et on l'inclut dès qu'au moins un jour du mois tombe dans la
    période demandée.
    """
    from accounting.models import Expense

    # Dépenses datées dans la période
    dated = Expense.objects.filter(
        incurred_on__isnull=False,
        incurred_on__gte=start_date,
        incurred_on__lte=end_date,
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

    # Dépenses non datées : on les compte au prorata du mois si le mois
    # intersecte la période. Pour rester simple et prévisible, on les
    # inclut intégralement quand le 1er du mois est dans la période.
    undated = Decimal('0')
    months_seen = set()
    cur = date(start_date.year, start_date.month, 1)
    end_cap = date(end_date.year, end_date.month, 1)
    while cur <= end_cap:
        months_seen.add((cur.year, cur.month))
        # avancer d'un mois
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)

    if months_seen:
        from django.db.models import Q
        q = Q()
        for y, m in months_seen:
            q |= Q(monthly__year=y, monthly__month=m)
        undated = Expense.objects.filter(
            incurred_on__isnull=True,
        ).filter(q).aggregate(total=Sum('amount'))['total'] or Decimal('0')

    return dated + undated
