from calendar import monthrange
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

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
        cost=Sum('total_purchase_cost'),
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

    Règle d'attribution :
      - Dépense AVEC `incurred_on` : compte uniquement si la date tombe dans la
        période demandée (factuel).
      - Dépense SANS `incurred_on` (saisie comme "ce mois j'ai dépensé X" sans
        jour précis) : répartie uniformément sur tous les jours du mois.
        On en attribue à la période la quote-part au prorata du nombre de jours
        de chevauchement.

    Cela évite le bug "20 DH du 24 avril déduits aussi du 23, 25, 26..." :
    une dépense non-datée du mois d'avril (30 jours) regardée pour 1 seul jour
    contribue 20/30 ≈ 0,67 DH ; sur le mois entier on retrouve bien 20 DH.
    """
    from accounting.models import Expense

    # 1) Dépenses datées : exact match sur incurred_on dans la période
    dated = Expense.objects.filter(
        incurred_on__isnull=False,
        incurred_on__gte=start_date,
        incurred_on__lte=end_date,
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

    # 2) Dépenses non-datées : prorata sur le nombre de jours d'intersection
    #    entre la période demandée et chaque mois concerné.
    undated_total = Decimal('0')
    cur = date(start_date.year, start_date.month, 1)
    while cur <= end_date:
        days_in_month = monthrange(cur.year, cur.month)[1]
        month_end = date(cur.year, cur.month, days_in_month)
        eff_start = max(start_date, cur)
        eff_end = min(end_date, month_end)
        if eff_end >= eff_start:
            days_overlap = (eff_end - eff_start).days + 1
            month_undated = Expense.objects.filter(
                incurred_on__isnull=True,
                monthly__year=cur.year,
                monthly__month=cur.month,
            ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
            if month_undated:
                ratio = Decimal(days_overlap) / Decimal(days_in_month)
                undated_total += (month_undated * ratio).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
        # mois suivant
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)

    return dated + undated_total
