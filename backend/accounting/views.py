from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import AuditLog
from core.permissions import IsAdminRole
from calendar import monthrange
from datetime import date as _date

from sales.aggregates import (
    revenue_for_month,
    gross_margin_for_period,
    operating_expenses_for_period,
)
from sales.models import Return, Sale, SaleItem

from .models import CashRegisterAdjustment, ExpenseCategory, MonthlyAccounting, Expense
from .serializers import (
    CashRegisterAdjustmentSerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    MonthlyAccountingSerializer,
)


def sales_margin_analytics(start, end):
    """Detail ventes + articles vendus pour une periode.

    Les remises sont reparties au prorata des lignes afin que la marge article
    reste coherente avec la marge vente.
    """
    sales = (
        Sale.objects.filter(
            created_at__date__gte=start,
            created_at__date__lte=end,
        )
        .prefetch_related('items')
        .order_by('-created_at', '-id')
    )

    sale_rows = []
    product_map = {}

    for sale in sales:
        items = list(sale.items.all())
        gross_revenue = sum(
            (item.unit_price_ht or Decimal('0')) * item.quantity
            for item in items
        )
        total_cost = sum(item.total_purchase_cost or Decimal('0') for item in items)
        discount = sale.discount_amount or Decimal('0')
        sale_margin = gross_revenue - total_cost - discount

        sale_rows.append({
            'id': sale.id,
            'created_at': sale.created_at,
            'payment_method': sale.payment_method,
            'items_count': sum(item.quantity for item in items),
            'revenue': float(sale.total_ttc or Decimal('0')),
            'gross_revenue': float(gross_revenue),
            'discount': float(discount),
            'purchase_cost': float(total_cost),
            'margin': float(sale_margin),
        })

        for item in items:
            line_revenue = (item.unit_price_ht or Decimal('0')) * item.quantity
            discount_share = Decimal('0')
            if gross_revenue > 0 and discount > 0:
                discount_share = (discount * line_revenue / gross_revenue).quantize(
                    Decimal('0.01'), rounding=ROUND_HALF_UP,
                )
            net_revenue = line_revenue - discount_share
            cost = item.total_purchase_cost or Decimal('0')
            key = item.product_id or f"name:{item.product_name}"
            row = product_map.setdefault(key, {
                'product_id': item.product_id,
                'product_name': item.product_name,
                'quantity': 0,
                'revenue': Decimal('0'),
                'discount': Decimal('0'),
                'purchase_cost': Decimal('0'),
                'margin': Decimal('0'),
            })
            row['quantity'] += item.quantity
            row['revenue'] += net_revenue
            row['discount'] += discount_share
            row['purchase_cost'] += cost
            row['margin'] += net_revenue - cost

    product_rows = [
        {
            'product_id': row['product_id'],
            'product_name': row['product_name'],
            'quantity': row['quantity'],
            'revenue': float(row['revenue']),
            'discount': float(row['discount']),
            'purchase_cost': float(row['purchase_cost']),
            'margin': float(row['margin']),
        }
        for row in product_map.values()
    ]
    product_rows.sort(key=lambda row: (-row['quantity'], row['product_name']))

    return {
        'sales': sale_rows,
        'products': product_rows,
    }


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_destroy(self, instance):
        if instance.is_default:
            raise PermissionDenied(
                "Les catégories par défaut ne peuvent pas être supprimées."
            )
        instance.delete()


class MonthlyAccountingViewSet(viewsets.ModelViewSet):
    queryset = MonthlyAccounting.objects.prefetch_related(
        'expenses', 'expenses__category'
    )
    serializer_class = MonthlyAccountingSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        qs = super().get_queryset()
        year = self.request.query_params.get('year')
        month = self.request.query_params.get('month')
        if year:
            qs = qs.filter(year=year)
        if month:
            qs = qs.filter(month=month)
        return qs

    @action(detail=False, methods=['get'], url_path=r'by-period/(?P<year>\d+)/(?P<month>\d+)')
    def by_period(self, request, year=None, month=None):
        """Récupère ou crée l'entrée mensuelle, avec totaux et CA."""
        year, month = int(year), int(month)
        monthly, _ = MonthlyAccounting.objects.get_or_create(year=year, month=month)
        data = self.get_serializer(monthly).data
        data['revenue'] = float(revenue_for_month(year, month))

        # Bornes du mois pour le calcul de la marge brute
        last_day = monthrange(year, month)[1]
        start = _date(year, month, 1)
        end = _date(year, month, last_day)
        gross_margin = float(gross_margin_for_period(start, end))

        # Bénéfice net = marge brute (vente - achat) - dépenses d'exploitation.
        # Le prélèvement gérant est une distribution de bénéfice, pas une charge :
        # on l'expose à part pour le suivi de trésorerie.
        data['gross_margin'] = gross_margin
        data['net_profit'] = gross_margin - data['total_expenses']
        data['cash_after_withdrawal'] = (
            data['net_profit'] - float(monthly.manager_withdrawal)
        )
        data['sales_margin_detail'] = sales_margin_analytics(start, end)
        return Response(data)


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related('category', 'monthly').all()
    serializer_class = ExpenseSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        qs = super().get_queryset()
        year = self.request.query_params.get('year')
        month = self.request.query_params.get('month')
        if year:
            qs = qs.filter(monthly__year=year)
        if month:
            qs = qs.filter(monthly__month=month)
        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.CREATE,
            model_name='Expense',
            object_id=instance.id,
            object_repr=str(instance),
            request=self.request,
        )

    def perform_update(self, serializer):
        instance = serializer.save()
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='Expense',
            object_id=instance.id,
            object_repr=str(instance),
            request=self.request,
        )

    def perform_destroy(self, instance):
        obj_id = instance.id
        obj_repr = str(instance)
        super().perform_destroy(instance)
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.DELETE,
            model_name='Expense',
            object_id=obj_id,
            object_repr=obj_repr,
            request=self.request,
        )


class CashRegisterView(APIView):
    """Solde theorique de la caisse physique.

    Le solde est calcule sur toute la vie de la boutique :
    fonds/reglages + ventes especes - retours rembourses - depenses.
    """
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        return Response(self._summary())

    def post(self, request):
        action_name = request.data.get('action')
        if action_name == 'set_opening':
            return self._set_opening(request)
        if action_name == 'count':
            return self._count(request)
        return Response(
            {'detail': "Action inconnue. Utilisez 'set_opening' ou 'count'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _set_opening(self, request):
        opening_amount = self._money(request.data.get('opening_amount'))
        if opening_amount is None or opening_amount < 0:
            return Response(
                {'opening_amount': ['Montant de depart invalide.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_opening = self._adjustments_total(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
        )
        delta = opening_amount - existing_opening
        note = request.data.get('note') or 'Fonds de caisse defini'

        adjustment = CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
            amount=delta,
            counted_amount=opening_amount,
            note=note,
            created_by=request.user,
        )
        AuditLog.log(
            user=request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='CashRegisterAdjustment',
            object_id=adjustment.id,
            object_repr=f"Fonds caisse: {opening_amount}",
            request=request,
        )
        return Response(self._summary(), status=status.HTTP_201_CREATED)

    def _count(self, request):
        counted_amount = self._money(request.data.get('counted_amount'))
        if counted_amount is None or counted_amount < 0:
            return Response(
                {'counted_amount': ['Montant compte invalide.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_balance = self._balance()
        delta = counted_amount - current_balance
        note = request.data.get('note') or 'Reglage apres comptage reel'
        adjustment = CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.COUNT,
            amount=delta,
            counted_amount=counted_amount,
            note=note,
            created_by=request.user,
        )
        AuditLog.log(
            user=request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='CashRegisterAdjustment',
            object_id=adjustment.id,
            object_repr=f"Comptage caisse: {counted_amount}",
            changes={'delta': str(delta)},
            request=request,
        )
        return Response(self._summary(), status=status.HTTP_201_CREATED)

    def _summary(self):
        cash_sales = self._cash_sales_total()
        completed_returns = self._completed_returns_total()
        expenses = self._expenses_total()
        adjustments = self._adjustments_total()
        opening = self._adjustments_total(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
        )
        balance = adjustments + cash_sales - completed_returns - expenses
        last_adjustment = CashRegisterAdjustment.objects.order_by('-created_at').first()
        recent_adjustments = CashRegisterAdjustment.objects.select_related(
            'created_by'
        ).order_by('-created_at')[:10]

        return {
            'balance': float(balance),
            'opening_amount': float(opening),
            'cash_sales_total': float(cash_sales),
            'returns_total': float(completed_returns),
            'expenses_total': float(expenses),
            'adjustments_total': float(adjustments),
            'last_adjustment': (
                CashRegisterAdjustmentSerializer(last_adjustment).data
                if last_adjustment else None
            ),
            'recent_adjustments': CashRegisterAdjustmentSerializer(
                recent_adjustments, many=True
            ).data,
        }

    def _balance(self):
        return (
            self._adjustments_total()
            + self._cash_sales_total()
            - self._completed_returns_total()
            - self._expenses_total()
        )

    def _money(self, value):
        try:
            return Decimal(str(value)).quantize(Decimal('0.01'))
        except Exception:
            return None

    def _cash_sales_total(self):
        return (
            Sale.objects.filter(payment_method=Sale.PaymentMethod.CASH)
            .aggregate(total=Sum('total_ttc'))['total']
            or Decimal('0')
        )

    def _completed_returns_total(self):
        return (
            Return.objects.filter(status=Return.ReturnStatus.COMPLETED)
            .aggregate(total=Sum('refund_amount'))['total']
            or Decimal('0')
        )

    def _expenses_total(self):
        return (
            Expense.objects.filter(paid_from_cash=True)
            .aggregate(total=Sum('amount'))['total']
            or Decimal('0')
        )

    def _adjustments_total(self, adjustment_type=None):
        qs = CashRegisterAdjustment.objects.all()
        if adjustment_type:
            qs = qs.filter(adjustment_type=adjustment_type)
        return qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')


class YearSummaryView(APIView):
    """Synthèse annuelle: par mois, par trimestre, par catégorie."""
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        year = int(request.query_params.get('year', timezone.now().year))

        monthly_qs = MonthlyAccounting.objects.filter(year=year).prefetch_related(
            'expenses', 'expenses__category'
        )
        by_month = {m.month: m for m in monthly_qs}

        months = []
        for m in range(1, 13):
            entry = by_month.get(m)
            withdrawal = float(entry.manager_withdrawal) if entry else 0.0
            expenses_total = (
                float(sum(e.amount for e in entry.expenses.all())) if entry else 0.0
            )
            revenue = float(revenue_for_month(year, m))
            last_day = monthrange(year, m)[1]
            gross_margin = float(gross_margin_for_period(
                _date(year, m, 1), _date(year, m, last_day)
            ))
            net_profit = gross_margin - expenses_total
            months.append({
                'month': m,
                'label': date(year, m, 1).strftime('%b'),
                'revenue': revenue,
                'gross_margin': gross_margin,
                'manager_withdrawal': withdrawal,
                'expenses': expenses_total,
                'net_profit': net_profit,
            })

        # Quarters
        quarters = []
        for q in range(1, 5):
            qmonths = [x for x in months if (x['month'] - 1) // 3 + 1 == q]
            quarters.append({
                'quarter': q,
                'label': f'Q{q}',
                'revenue': sum(x['revenue'] for x in qmonths),
                'gross_margin': sum(x['gross_margin'] for x in qmonths),
                'manager_withdrawal': sum(x['manager_withdrawal'] for x in qmonths),
                'expenses': sum(x['expenses'] for x in qmonths),
                'net_profit': sum(x['net_profit'] for x in qmonths),
            })

        # Expense breakdown by category for the year
        breakdown_qs = (
            Expense.objects.filter(monthly__year=year)
            .values('category__name')
            .annotate(total=Sum('amount'))
            .order_by('-total')
        )
        category_breakdown = [
            {'category': row['category__name'], 'total': float(row['total'] or 0)}
            for row in breakdown_qs
        ]

        totals = {
            'revenue': sum(m['revenue'] for m in months),
            'gross_margin': sum(m['gross_margin'] for m in months),
            'manager_withdrawal': sum(m['manager_withdrawal'] for m in months),
            'expenses': sum(m['expenses'] for m in months),
            'net_profit': sum(m['net_profit'] for m in months),
        }

        return Response({
            'year': year,
            'months': months,
            'quarters': quarters,
            'category_breakdown': category_breakdown,
            'totals': totals,
            'sales_margin_detail': sales_margin_analytics(
                date(year, 1, 1), date(year, 12, 31)
            ),
        })


class PeriodSummaryView(APIView):
    """Synthese comptable pour une journee ou une semaine.

    Performance : pour la vue semaine, on agrège tous les jours en une seule
    passe SQL (3-4 requêtes au total) au lieu d'appeler les helpers en boucle
    pour chaque jour (28+ requêtes).
    """
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        period_type = request.query_params.get('type', 'day')
        raw_date = request.query_params.get('date')
        target = (
            date.fromisoformat(raw_date)
            if raw_date
            else timezone.localdate()
        )

        if period_type == 'week':
            start = target - timedelta(days=target.weekday())
            end = start + timedelta(days=6)
        else:
            period_type = 'day'
            start = target
            end = target

        # Agrégats journaliers (en 1 requête chacun, pas par jour)
        revenue_by_day = self._revenue_by_day(start, end)
        margin_by_day = self._gross_margin_by_day(start, end)
        dated_expenses_by_day = self._dated_expenses_by_day(start, end)

        # Quote-part journalière des dépenses non-datées (calcul Python pur)
        undated_share_by_day = self._undated_share_by_day(start, end)

        # Totaux période
        revenue = sum(revenue_by_day.values(), Decimal('0'))
        gross_margin = sum(margin_by_day.values(), Decimal('0'))
        dated_total = sum(dated_expenses_by_day.values(), Decimal('0'))
        undated_total = sum(undated_share_by_day.values(), Decimal('0'))
        expenses = dated_total + undated_total
        net_profit = gross_margin - expenses

        # Liste des dépenses datées dans la période (pas les non-datées,
        # qui sont des "moyennes mensuelles" - on les expose à part).
        dated_expense_rows = (
            Expense.objects.filter(
                incurred_on__isnull=False,
                incurred_on__gte=start,
                incurred_on__lte=end,
            )
            .select_related('category')
            .order_by('-incurred_on', '-created_at')
        )
        expenses_detail = ExpenseSerializer(dated_expense_rows, many=True).data

        # Breakdown par catégorie : datées + quote-part des non-datées
        category_breakdown = self._category_breakdown(start, end)

        daily = []
        if period_type == 'week':
            for offset in range(7):
                day = start + timedelta(days=offset)
                day_revenue = revenue_by_day.get(day, Decimal('0'))
                day_margin = margin_by_day.get(day, Decimal('0'))
                day_expenses = (
                    dated_expenses_by_day.get(day, Decimal('0'))
                    + undated_share_by_day.get(day, Decimal('0'))
                )
                daily.append({
                    'date': day.isoformat(),
                    'label': day.strftime('%a %d/%m'),
                    'revenue': float(day_revenue),
                    'gross_margin': float(day_margin),
                    'expenses': float(day_expenses),
                    'net_profit': float(day_margin - day_expenses),
                })

        return Response({
            'type': period_type,
            'date': target.isoformat(),
            'start_date': start.isoformat(),
            'end_date': end.isoformat(),
            'revenue': float(revenue),
            'gross_margin': float(gross_margin),
            'expenses': float(expenses),
            'expenses_dated': float(dated_total),
            'expenses_undated_share': float(undated_total),
            'net_profit': float(net_profit),
            'expenses_detail': expenses_detail,
            'category_breakdown': category_breakdown,
            'daily': daily,
            'sales_margin_detail': sales_margin_analytics(start, end),
        })

    # ---- Helpers agrégés ----

    def _revenue_by_day(self, start, end):
        rows = (
            Sale.objects.filter(
                created_at__date__gte=start,
                created_at__date__lte=end,
            )
            .annotate(d=TruncDate('created_at'))
            .values('d')
            .annotate(total=Sum('total_ttc'))
        )
        return {row['d']: row['total'] or Decimal('0') for row in rows}

    def _gross_margin_by_day(self, start, end):
        # Marge brute = (vente - achat) - remise, agrégée par jour.
        items = (
            SaleItem.objects.filter(
                sale__created_at__date__gte=start,
                sale__created_at__date__lte=end,
            )
            .annotate(d=TruncDate('sale__created_at'))
            .values('d')
            .annotate(
                revenue=Sum(F('unit_price_ht') * F('quantity')),
                cost=Sum('total_purchase_cost'),
            )
        )
        margin = {
            row['d']: (row['revenue'] or Decimal('0')) - (row['cost'] or Decimal('0'))
            for row in items
        }
        # Soustraire les remises par jour
        discounts = (
            Sale.objects.filter(
                created_at__date__gte=start,
                created_at__date__lte=end,
            )
            .annotate(d=TruncDate('created_at'))
            .values('d')
            .annotate(total=Sum('discount_amount'))
        )
        for row in discounts:
            margin[row['d']] = margin.get(row['d'], Decimal('0')) - (
                row['total'] or Decimal('0')
            )
        return margin

    def _dated_expenses_by_day(self, start, end):
        rows = (
            Expense.objects.filter(
                incurred_on__isnull=False,
                incurred_on__gte=start,
                incurred_on__lte=end,
            )
            .values('incurred_on')
            .annotate(total=Sum('amount'))
        )
        return {row['incurred_on']: row['total'] or Decimal('0') for row in rows}

    def _undated_share_by_day(self, start, end):
        """Pour chaque mois intersectant la période, on récupère le total
        des dépenses non-datées et on attribue amount/days_in_month à
        chaque jour qui est dans la période.
        """
        result = {}
        cur = date(start.year, start.month, 1)
        while cur <= end:
            days_in_month = monthrange(cur.year, cur.month)[1]
            month_end = date(cur.year, cur.month, days_in_month)
            eff_start = max(start, cur)
            eff_end = min(end, month_end)
            if eff_end >= eff_start:
                month_undated = Expense.objects.filter(
                    incurred_on__isnull=True,
                    monthly__year=cur.year,
                    monthly__month=cur.month,
                ).aggregate(total=Sum('amount'))['total'] or Decimal('0')
                if month_undated:
                    daily_share = (month_undated / Decimal(days_in_month)).quantize(
                        Decimal('0.01'), rounding=ROUND_HALF_UP,
                    )
                    d = eff_start
                    while d <= eff_end:
                        result[d] = result.get(d, Decimal('0')) + daily_share
                        d += timedelta(days=1)
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)
        return result

    def _category_breakdown(self, start, end):
        # Datées
        dated_rows = (
            Expense.objects.filter(
                incurred_on__isnull=False,
                incurred_on__gte=start,
                incurred_on__lte=end,
            )
            .values('category__name')
            .annotate(total=Sum('amount'))
        )
        breakdown = {row['category__name']: row['total'] or Decimal('0') for row in dated_rows}
        # Non-datées au prorata
        cur = date(start.year, start.month, 1)
        while cur <= end:
            days_in_month = monthrange(cur.year, cur.month)[1]
            month_end = date(cur.year, cur.month, days_in_month)
            eff_start = max(start, cur)
            eff_end = min(end, month_end)
            if eff_end >= eff_start:
                days_overlap = (eff_end - eff_start).days + 1
                ratio = Decimal(days_overlap) / Decimal(days_in_month)
                month_rows = (
                    Expense.objects.filter(
                        incurred_on__isnull=True,
                        monthly__year=cur.year,
                        monthly__month=cur.month,
                    )
                    .values('category__name')
                    .annotate(total=Sum('amount'))
                )
                for row in month_rows:
                    share = ((row['total'] or Decimal('0')) * ratio).quantize(
                        Decimal('0.01'), rounding=ROUND_HALF_UP,
                    )
                    breakdown[row['category__name']] = breakdown.get(
                        row['category__name'], Decimal('0'),
                    ) + share
            if cur.month == 12:
                cur = date(cur.year + 1, 1, 1)
            else:
                cur = date(cur.year, cur.month + 1, 1)

        return [
            {'category': name, 'total': float(total)}
            for name, total in sorted(
                breakdown.items(), key=lambda kv: kv[1], reverse=True,
            )
            if total > 0
        ]
