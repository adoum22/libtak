from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Case, DecimalField, F, Sum, When
from django.utils import timezone

from .models import Return, Sale, SaleItem


def local_datetime_bounds(start_date, end_date):
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(datetime.combine(start_date, time.min), tz)
    end_dt = timezone.make_aware(datetime.combine(end_date, time.max), tz)
    return start_dt, end_dt


def revenue_for_month(year: int, month: int) -> Decimal:
    """Net recognized revenue for a calendar month (sales minus refunds)."""
    last_day = monthrange(year, month)[1]
    start_dt, end_dt = local_datetime_bounds(
        date(year, month, 1),
        date(year, month, last_day),
    )
    return financials_for_period(
        date(year, month, 1),
        date(year, month, last_day),
    )['net_revenue']


def completed_returns_for_period(start_date, end_date):
    """Completed refunds recognized by their effective completion date."""
    start_dt, end_dt = local_datetime_bounds(start_date, end_date)
    return Return.objects.filter(
        status=Return.ReturnStatus.COMPLETED,
        completed_at__gte=start_dt,
        completed_at__lte=end_dt,
    )


def recognized_refund_expression():
    """Expression SQL du remboursement affectant le revenu reconnu."""
    return Case(
        When(
            sale__payment_method=Sale.PaymentMethod.CREDIT,
            then=F('cash_refund_amount'),
        ),
        default=F('refund_amount'),
        output_field=DecimalField(max_digits=10, decimal_places=2),
    )


def recognized_return_effect(return_order):
    """Montants à extourner selon ce qui avait réellement été encaissé.

    Une vente immédiate reconnaît tout le retour. Pour une vente à crédit,
    seule la somme effectivement rendue au client avait déjà été reconnue en
    chiffre d'affaires; la part restante annule simplement sa dette.
    """
    is_credit = return_order.sale.payment_method == Sale.PaymentMethod.CREDIT
    recognized_refund = (
        return_order.cash_refund_amount
        if is_credit
        else return_order.refund_amount
    ) or Decimal('0.00')
    restocked_cost = sum(
        (
            item.sale_item.unit_purchase_price * item.quantity
            for item in return_order.items.all()
            if item.restock
        ),
        Decimal('0.00'),
    )
    if is_credit:
        full_return = return_order.refund_amount or Decimal('0.00')
        if full_return <= 0 or recognized_refund <= 0:
            recognized_cost = Decimal('0.00')
        else:
            recognized_cost = (
                restocked_cost * recognized_refund / full_return
            ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    else:
        recognized_cost = restocked_cost
    return recognized_refund, recognized_cost


def recognized_return_effects_by_day(start_date, end_date):
    """Effets revenu/coût des retours, groupés par date de complétion."""
    refunds = {}
    returned_costs = {}
    tz = timezone.get_current_timezone()
    returns = (
        completed_returns_for_period(start_date, end_date)
        .select_related('sale')
        .prefetch_related('items__sale_item')
    )
    for return_order in returns:
        day = timezone.localtime(return_order.completed_at, tz).date()
        refund, returned_cost = recognized_return_effect(return_order)
        refunds[day] = refunds.get(day, Decimal('0.00')) + refund
        returned_costs[day] = (
            returned_costs.get(day, Decimal('0.00')) + returned_cost
        )
    return refunds, returned_costs


def _credit_payments_total(start_dt, end_dt) -> Decimal:
    """Cash received from credit customers during the period."""
    from credit.models import CreditPayment

    return (
        CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
            status=CreditPayment.PaymentStatus.ACTIVE,
        ).aggregate(total=Sum('amount'))['total']
        or Decimal('0')
    )


def _credit_payments_cost(start_dt, end_dt) -> Decimal:
    """Recognize FIFO cost proportionally as credit payments are collected."""
    from credit.models import CreditPayment

    payments = list(
        CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
            status=CreditPayment.PaymentStatus.ACTIVE,
        ).select_related('credit_sale__sale')
    )
    sale_ids = {payment.credit_sale.sale_id for payment in payments}
    cost_by_sale = {
        row['sale_id']: row['total'] or Decimal('0')
        for row in SaleItem.objects.filter(sale_id__in=sale_ids)
        .values('sale_id')
        .annotate(total=Sum('total_purchase_cost'))
    }
    total = Decimal('0')
    for payment in payments:
        sale = payment.credit_sale.sale
        sale_total = sale.total_ttc or Decimal('0')
        if sale_total > 0:
            total += (
                (payment.amount or Decimal('0'))
                * cost_by_sale.get(sale.id, Decimal('0'))
                / sale_total
            )
    return total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def financials_for_period(start_date, end_date):
    """Single financial truth used by reports and accounting.

    Revenue is recognized on the sale date and refunds on the date they are
    completed. Cost of goods is reversed only for items returned to sellable
    stock; damaged/non-restocked goods remain a real cost.
    """
    start_dt, end_dt = local_datetime_bounds(start_date, end_date)
    sales = Sale.objects.filter(
        created_at__gte=start_dt,
        created_at__lte=end_dt,
    )
    recognized_sales = sales.exclude(payment_method=Sale.PaymentMethod.CREDIT)
    immediate_revenue = (
        recognized_sales.aggregate(total=Sum('total_ttc'))['total']
        or Decimal('0')
    )
    immediate_cost = SaleItem.objects.filter(sale__in=recognized_sales).aggregate(
        total=Sum('total_purchase_cost'),
    )['total'] or Decimal('0')
    credit_revenue = _credit_payments_total(start_dt, end_dt)
    credit_cost = _credit_payments_cost(start_dt, end_dt)
    gross_revenue = immediate_revenue + credit_revenue
    gross_cost = immediate_cost + credit_cost

    completed_returns = completed_returns_for_period(start_date, end_date)
    refunds_by_day, returned_costs_by_day = recognized_return_effects_by_day(
        start_date, end_date,
    )
    refunds = sum(refunds_by_day.values(), Decimal('0.00'))
    returned_cost = sum(returned_costs_by_day.values(), Decimal('0.00'))

    net_revenue = gross_revenue - refunds
    net_cost = gross_cost - returned_cost
    return {
        'gross_revenue': gross_revenue,
        'refunds': refunds,
        'net_revenue': net_revenue,
        'gross_cost': gross_cost,
        'returned_cost': returned_cost,
        'net_cost': net_cost,
        'gross_margin': net_revenue - net_cost,
        'sales_count': sales.count(),
        'returns_count': completed_returns.count(),
    }


def gross_margin_for_period(start_date, end_date) -> Decimal:
    """Marge brute pour une période = Σ (prix_vente - prix_achat) × quantité.

    Source unique pour le calcul du bénéfice avant déduction des dépenses
    d'exploitation. Utilisée par accounting et reporting pour garantir la
    cohérence du chiffre.
    """
    return financials_for_period(start_date, end_date)['gross_margin']


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
