from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Sum, F
from django.utils import timezone

from .models import Sale, SaleItem


def local_datetime_bounds(start_date, end_date):
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(datetime.combine(start_date, time.min), tz)
    end_dt = timezone.make_aware(datetime.combine(end_date, time.max), tz)
    return start_dt, end_dt


def revenue_for_month(year: int, month: int) -> Decimal:
    """Total revenue for a given calendar month.

    Comptabilité de caisse pour les ventes à crédit :
    - Les ventes encaissées comptant (CASH/CARD/OTHER) sont reconnues à leur date.
    - Les ventes à crédit (CREDIT) ne sont PAS reconnues à leur date.
    - Les règlements de crédit (CreditPayment) sont reconnus à leur date.
    """
    last_day = monthrange(year, month)[1]
    start_dt, end_dt = local_datetime_bounds(
        date(year, month, 1),
        date(year, month, last_day),
    )
    cash_sales = (
        Sale.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .exclude(payment_method=Sale.PaymentMethod.CREDIT)
        .aggregate(total=Sum('total_ttc'))['total']
        or Decimal('0')
    )
    credit_payments = _credit_payments_total(start_dt, end_dt)
    return cash_sales + credit_payments


def _credit_payments_total(start_dt, end_dt) -> Decimal:
    """Somme des règlements de crédit reçus dans la période."""
    try:
        from credit.models import CreditPayment
    except Exception:
        return Decimal('0')
    return (
        CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .aggregate(total=Sum('amount'))['total']
        or Decimal('0')
    )


def _credit_payments_cost(start_dt, end_dt) -> Decimal:
    """Coût d'achat reconnu au prorata des règlements de crédit.

    Pour chaque CreditPayment dans la période on attribue
    (payment.amount / sale.total_ttc) * total_purchase_cost_de_la_sale.
    Cela conserve la marge brute en comptabilité de caisse.
    """
    try:
        from credit.models import CreditPayment
    except Exception:
        return Decimal('0')

    payments = (
        CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .select_related('credit_sale__sale')
    )
    total = Decimal('0')
    sale_ids = {p.credit_sale.sale_id for p in payments}
    if not sale_ids:
        return total
    cost_by_sale = {
        row['sale_id']: row['total'] or Decimal('0')
        for row in SaleItem.objects.filter(sale_id__in=sale_ids)
        .values('sale_id')
        .annotate(total=Sum('total_purchase_cost'))
    }
    for payment in payments:
        sale = payment.credit_sale.sale
        sale_total = sale.total_ttc or Decimal('0')
        if sale_total <= 0:
            continue
        ratio = (payment.amount or Decimal('0')) / sale_total
        sale_cost = cost_by_sale.get(sale.id, Decimal('0'))
        total += (sale_cost * ratio).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP,
        )
    return total


def gross_margin_for_period(start_date, end_date) -> Decimal:
    """Marge brute pour une période = Σ (prix_vente - prix_achat) × quantité.

    Comptabilité de caisse pour le crédit : les ventes à crédit sont exclues
    et les règlements de crédit sont reconnus à leur date avec coût au prorata.
    """
    start_dt, end_dt = local_datetime_bounds(start_date, end_date)
    items = SaleItem.objects.filter(
        sale__created_at__gte=start_dt,
        sale__created_at__lte=end_dt,
    ).exclude(sale__payment_method=Sale.PaymentMethod.CREDIT)
    agg = items.aggregate(
        revenue=Sum(F('unit_price_ht') * F('quantity')),
        cost=Sum('total_purchase_cost'),
    )
    discounts = (
        Sale.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .exclude(payment_method=Sale.PaymentMethod.CREDIT)
        .aggregate(total=Sum('discount_amount'))['total']
        or Decimal('0')
    )
    cash_margin = (
        (agg['revenue'] or Decimal('0'))
        - (agg['cost'] or Decimal('0'))
        - discounts
    )
    credit_revenue = _credit_payments_total(start_dt, end_dt)
    credit_cost = _credit_payments_cost(start_dt, end_dt)
    return cash_margin + credit_revenue - credit_cost


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
