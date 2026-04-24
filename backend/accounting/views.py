from datetime import date

from django.db.models import Sum
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdminRole
from calendar import monthrange
from datetime import date as _date

from sales.aggregates import (
    revenue_for_month,
    gross_margin_for_period,
)

from .models import ExpenseCategory, MonthlyAccounting, Expense
from .serializers import (
    ExpenseCategorySerializer,
    ExpenseSerializer,
    MonthlyAccountingSerializer,
)


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

        # Bénéfice net = marge brute (vente HT - achat) - dépenses d'exploitation.
        # Le prélèvement gérant est une distribution de bénéfice, pas une charge :
        # on l'expose à part pour le suivi de trésorerie.
        data['gross_margin'] = gross_margin
        data['net_profit'] = gross_margin - data['total_expenses']
        data['cash_after_withdrawal'] = (
            data['net_profit'] - float(monthly.manager_withdrawal)
        )
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
        })
