import hashlib
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import OpenApiTypes, extend_schema

from core.models import AuditLog
from core.permissions import IsAdminRole
from inventory.models import SupplierPayment
from calendar import monthrange
from datetime import date as _date

from sales.aggregates import (
    completed_returns_for_period,
    financials_for_period,
    revenue_for_month,
    gross_margin_for_period,
    operating_expenses_for_period,
    recognized_return_effects_by_day,
)
from sales.models import Return, Sale, SaleItem

from .models import (
    CashRegisterAdjustment,
    CashRegisterState,
    ExpenseCategory,
    MonthlyAccounting,
    Expense,
)
from .serializers import (
    CashRegisterAdjustmentSerializer,
    CashRegisterOperationSerializer,
    CashRegisterSummarySerializer,
    CashierExpenseCreateSerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    ManagerWithdrawalCreateSerializer,
    MonthlyAccountingSerializer,
)

MANAGER_WITHDRAWAL_CATEGORY = 'Retrait gérant'


def expense_operation_payload_hash(
    action_name,
    *,
    monthly_id,
    category_id,
    amount,
    description,
    incurred_on,
    paid_from_cash,
):
    """Canonical fingerprint used to make expense retries side-effect free."""
    payload = json.dumps({
        'action': action_name,
        'monthly_id': int(monthly_id),
        'category_id': int(category_id),
        'amount': str(Decimal(amount).quantize(Decimal('0.01'))),
        'description': str(description or '').strip(),
        'incurred_on': incurred_on.isoformat() if incurred_on else None,
        'paid_from_cash': bool(paid_from_cash),
    }, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def lock_and_find_expense_operation(request, operation_id, payload_hash):
    """Serialize cash-affecting writes and validate an optional retry key."""
    CashRegisterState.objects.get_or_create(pk=1)
    CashRegisterState.objects.select_for_update().get(pk=1)
    if not operation_id:
        return None
    existing = Expense.objects.select_for_update().filter(
        operation_id=operation_id,
    ).first()
    if not existing:
        return None
    if (
        existing.created_by_id != request.user.id
        or existing.operation_payload_hash != payload_hash
    ):
        return Response(
            {
                'operation_id': [
                    'Cet identifiant a déjà été utilisé pour une autre dépense.'
                ],
            },
            status=status.HTTP_409_CONFLICT,
        )
    return existing


def find_expense_after_integrity_error(request, operation_id, payload_hash):
    if not operation_id:
        return None
    existing = Expense.objects.filter(operation_id=operation_id).first()
    if (
        existing
        and existing.created_by_id == request.user.id
        and existing.operation_payload_hash == payload_hash
    ):
        return existing
    return None


def supplier_payments_for_period(start, end, *, method=None):
    """Trésorerie fournisseur informative, jamais intégrée au bénéfice."""
    queryset = SupplierPayment.objects.filter(
        status=SupplierPayment.PaymentStatus.ACTIVE,
        paid_on__gte=start,
        paid_on__lte=end,
    )
    if method:
        queryset = queryset.filter(method=method)
    return queryset.aggregate(total=Sum('amount'))['total'] or Decimal('0.00')


class CanReadExpenseCategories(IsAuthenticated):
    """Admins gerent les categories, vendeurs les lisent pour saisir une depense."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.method in SAFE_METHODS:
            return True
        return request.user.is_admin_role


def sync_manager_withdrawal(monthly):
    total = (
        monthly.expenses.filter(category__name=MANAGER_WITHDRAWAL_CATEGORY)
        .aggregate(total=Sum('amount'))['total']
        or Decimal('0')
    )
    if monthly.manager_withdrawal != total:
        monthly.manager_withdrawal = total
        monthly.save(update_fields=['manager_withdrawal', 'updated_at'])
    return total


def local_datetime_bounds(start, end):
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(datetime.combine(start, time.min), tz)
    end_dt = timezone.make_aware(datetime.combine(end, time.max), tz)
    return start_dt, end_dt


def sales_margin_analytics(start, end):
    """Detail ventes + articles vendus pour une periode.

    Les remises sont reparties au prorata des lignes afin que la marge article
    reste coherente avec la marge vente.
    """
    start_dt, end_dt = local_datetime_bounds(start, end)
    sales = (
        Sale.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        )
        .exclude(payment_method=Sale.PaymentMethod.CREDIT)
        .prefetch_related('items')
        .order_by('-created_at', '-id')
    )

    sale_rows = []
    return_rows = []
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

        allocated_discount = Decimal('0')
        for index, item in enumerate(items):
            line_revenue = (item.unit_price_ht or Decimal('0')) * item.quantity
            discount_share = Decimal('0')
            if gross_revenue > 0 and discount > 0:
                remaining_discount = max(
                    discount - allocated_discount,
                    Decimal('0'),
                )
                if index == len(items) - 1:
                    discount_share = remaining_discount
                else:
                    discount_share = min(
                        (discount * line_revenue / gross_revenue).quantize(
                            Decimal('0.01'), rounding=ROUND_HALF_UP,
                        ),
                        remaining_discount,
                    )
                allocated_discount += discount_share
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

    completed_returns = completed_returns_for_period(start, end).prefetch_related(
        'items__sale_item',
    )
    for return_order in completed_returns:
        return_items = list(return_order.items.all())
        gross_return_value = sum(
            item.sale_item.unit_price_ht * item.quantity
            for item in return_items
        )
        allocated_refund = Decimal('0')
        for index, item in enumerate(return_items):
            sale_item = item.sale_item
            if index == len(return_items) - 1:
                refund_share = return_order.refund_amount - allocated_refund
            elif gross_return_value > 0:
                refund_share = (
                    return_order.refund_amount
                    * sale_item.unit_price_ht
                    * item.quantity
                    / gross_return_value
                ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            else:
                refund_share = Decimal('0')
            allocated_refund += refund_share
            reversed_cost = (
                sale_item.unit_purchase_price * item.quantity
                if item.restock
                else Decimal('0')
            )
            key = sale_item.product_id or f"name:{sale_item.product_name}"
            row = product_map.setdefault(key, {
                'product_id': sale_item.product_id,
                'product_name': sale_item.product_name,
                'quantity': 0,
                'revenue': Decimal('0'),
                'discount': Decimal('0'),
                'purchase_cost': Decimal('0'),
                'margin': Decimal('0'),
            })
            row['quantity'] -= item.quantity
            row['revenue'] -= refund_share
            row['purchase_cost'] -= reversed_cost
            row['margin'] += -refund_share + reversed_cost

        return_rows.append({
            'id': return_order.id,
            'sale_id': return_order.sale_id,
            'completed_at': return_order.completed_at,
            'refund_method': return_order.refund_method,
            'refund_amount': float(return_order.refund_amount),
            'items_count': sum(item.quantity for item in return_items),
        })

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
        'returns': return_rows,
        'products': product_rows,
    }


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    permission_classes = [CanReadExpenseCategories]

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
        try:
            year, month = int(year), int(month)
            _date(year, month, 1)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Periode invalide.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        monthly, _ = MonthlyAccounting.objects.get_or_create(year=year, month=month)
        sync_manager_withdrawal(monthly)
        data = self.get_serializer(monthly).data
        data['revenue'] = float(revenue_for_month(year, month))

        # Bornes du mois pour le calcul de la marge brute
        last_day = monthrange(year, month)[1]
        start = _date(year, month, 1)
        end = _date(year, month, last_day)
        gross_margin = float(gross_margin_for_period(start, end))

        # Benefice net = marge brute (vente - achat) - depenses d'exploitation.
        # Les retraits gerant sont maintenant de vraies depenses payees depuis
        # la caisse, donc ils sont deja inclus dans total_expenses.
        data['gross_margin'] = gross_margin
        data['net_profit'] = gross_margin - data['total_expenses']
        data['cash_after_withdrawal'] = data['net_profit']
        data['supplier_payments_total'] = float(
            supplier_payments_for_period(start, end)
        )
        data['sales_margin_detail'] = sales_margin_analytics(start, end)
        return Response(data)

    @action(detail=True, methods=['post'], url_path='withdraw')
    def withdraw(self, request, pk=None):
        """Enregistre un retrait gérant comme dépense payée depuis la caisse."""
        input_serializer = ManagerWithdrawalCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        withdrawal = input_serializer.validated_data
        monthly = self.get_object()
        amount = withdrawal['amount']
        note = (withdrawal.get('note') or 'Retrait gérant').strip()
        incurred_on = withdrawal.get('incurred_on', timezone.localdate())
        if incurred_on.year != monthly.year or incurred_on.month != monthly.month:
            return Response(
                {
                    'incurred_on': [
                        'La date du retrait doit appartenir au mois comptable choisi.'
                    ],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        operation_id = withdrawal.get('operation_id')
        payload_hash = ''

        try:
            with transaction.atomic():
                monthly = MonthlyAccounting.objects.select_for_update().get(
                    pk=monthly.pk,
                )
                category, _ = ExpenseCategory.objects.get_or_create(
                    name=MANAGER_WITHDRAWAL_CATEGORY,
                )
                payload_hash = expense_operation_payload_hash(
                    'manager_withdrawal',
                    monthly_id=monthly.pk,
                    category_id=category.pk,
                    amount=amount,
                    description=note,
                    incurred_on=incurred_on,
                    paid_from_cash=True,
                )
                duplicate = lock_and_find_expense_operation(
                    request,
                    operation_id,
                    payload_hash,
                )
                if isinstance(duplicate, Response):
                    return duplicate
                if duplicate is None:
                    expense = Expense.objects.create(
                        monthly=monthly,
                        category=category,
                        amount=amount,
                        description=note,
                        incurred_on=incurred_on,
                        paid_from_cash=True,
                        created_by=request.user,
                        operation_id=operation_id,
                        operation_payload_hash=(payload_hash if operation_id else ''),
                    )
                    sync_manager_withdrawal(monthly)
                    AuditLog.log(
                        user=request.user,
                        action=AuditLog.ActionType.CREATE,
                        model_name='Expense',
                        object_id=expense.id,
                        object_repr=f"Retrait gérant: {amount}",
                        request=request,
                    )
        except IntegrityError:
            existing = find_expense_after_integrity_error(
                request,
                operation_id,
                payload_hash,
            )
            if existing is None:
                return Response(
                    {'operation_id': ['Identifiant de dépense déjà utilisé.']},
                    status=status.HTTP_409_CONFLICT,
                )
        return self.by_period(request, year=monthly.year, month=monthly.month)


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related(
        'category',
        'monthly',
        'created_by',
    ).all()
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

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        expense_data = serializer.validated_data
        operation_id = expense_data.get('operation_id')
        payload_hash = expense_operation_payload_hash(
            'admin_expense',
            monthly_id=expense_data['monthly'].pk,
            category_id=expense_data['category'].pk,
            amount=expense_data['amount'],
            description=expense_data.get('description', ''),
            incurred_on=expense_data.get('incurred_on'),
            paid_from_cash=expense_data.get('paid_from_cash', True),
        )

        try:
            with transaction.atomic():
                duplicate = lock_and_find_expense_operation(
                    request,
                    operation_id,
                    payload_hash,
                )
                if isinstance(duplicate, Response):
                    return duplicate
                if duplicate is not None:
                    return Response(
                        self.get_serializer(duplicate).data,
                        status=status.HTTP_200_OK,
                    )

                instance = serializer.save(
                    created_by=request.user,
                    operation_payload_hash=(payload_hash if operation_id else ''),
                )
                if instance.category.name == MANAGER_WITHDRAWAL_CATEGORY:
                    sync_manager_withdrawal(instance.monthly)
                AuditLog.log(
                    user=request.user,
                    action=AuditLog.ActionType.CREATE,
                    model_name='Expense',
                    object_id=instance.id,
                    object_repr=str(instance),
                    request=request,
                )
        except IntegrityError:
            existing = find_expense_after_integrity_error(
                request,
                operation_id,
                payload_hash,
            )
            if existing is not None:
                return Response(
                    self.get_serializer(existing).data,
                    status=status.HTTP_200_OK,
                )
            return Response(
                {'operation_id': ['Identifiant de dépense déjà utilisé.']},
                status=status.HTTP_409_CONFLICT,
            )

        headers = self.get_success_headers(serializer.data)
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED,
            headers=headers,
        )

    def perform_update(self, serializer):
        old_monthly = serializer.instance.monthly
        instance = serializer.save()
        if old_monthly.pk != instance.monthly_id:
            sync_manager_withdrawal(old_monthly)
        sync_manager_withdrawal(instance.monthly)
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='Expense',
            object_id=instance.id,
            object_repr=str(instance),
            request=self.request,
        )

    def perform_destroy(self, instance):
        monthly = instance.monthly
        obj_id = instance.id
        obj_repr = str(instance)
        super().perform_destroy(instance)
        sync_manager_withdrawal(monthly)
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

    @extend_schema(responses=CashRegisterSummarySerializer)
    def get(self, request):
        return Response(self._summary())

    @extend_schema(
        request=CashRegisterOperationSerializer,
        responses={200: CashRegisterSummarySerializer, 201: CashRegisterSummarySerializer},
    )
    def post(self, request):
        serializer = CashRegisterOperationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        operation = serializer.validated_data
        action_name = operation['action']
        if action_name == 'set_opening':
            return self._set_opening(request, operation)
        if action_name == 'count':
            return self._count(request, operation)

    @transaction.atomic
    def _set_opening(self, request, operation):
        opening_amount = operation['opening_amount']
        operation_id = operation.get('operation_id')
        note = operation.get('note') or 'Fonds de caisse defini'
        payload_hash = self._payload_hash('set_opening', opening_amount, note)
        duplicate = self._lock_and_find_operation(operation_id, payload_hash)
        if isinstance(duplicate, Response):
            return duplicate
        if duplicate:
            return Response(self._summary(), status=status.HTTP_200_OK)

        existing_opening = self._adjustments_total(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
        )
        delta = opening_amount - existing_opening

        adjustment = CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
            amount=delta,
            counted_amount=opening_amount,
            note=note,
            created_by=request.user,
            operation_id=operation_id,
            operation_payload_hash=payload_hash if operation_id else '',
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

    @transaction.atomic
    def _count(self, request, operation):
        counted_amount = operation['counted_amount']
        note = operation.get('note') or 'Reglage apres comptage reel'
        operation_id = operation.get('operation_id')
        payload_hash = self._payload_hash('count', counted_amount, note)
        duplicate = self._lock_and_find_operation(operation_id, payload_hash)
        if isinstance(duplicate, Response):
            return duplicate
        if duplicate:
            return Response(self._summary(), status=status.HTTP_200_OK)

        current_balance = self._balance()
        delta = counted_amount - current_balance
        adjustment = CashRegisterAdjustment.objects.create(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.COUNT,
            amount=delta,
            counted_amount=counted_amount,
            note=note,
            created_by=request.user,
            operation_id=operation_id,
            operation_payload_hash=payload_hash if operation_id else '',
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
        credit_payments = self._credit_payments_total()
        completed_returns = self._completed_returns_total()
        expenses = self._expenses_total()
        supplier_payments = self._supplier_cash_payments_total()
        adjustments = self._adjustments_total()
        opening = self._adjustments_total(
            adjustment_type=CashRegisterAdjustment.AdjustmentType.OPENING,
        )
        balance = (
            adjustments + cash_sales + credit_payments
            - completed_returns - expenses - supplier_payments
        )
        last_adjustment = CashRegisterAdjustment.objects.order_by('-created_at').first()
        recent_adjustments = CashRegisterAdjustment.objects.select_related(
            'created_by'
        ).order_by('-created_at')[:10]

        return {
            'balance': float(balance),
            'opening_amount': float(opening),
            'cash_sales_total': float(cash_sales),
            'credit_payments_total': float(credit_payments),
            'returns_total': float(completed_returns),
            'expenses_total': float(expenses),
            'supplier_payments_total': float(supplier_payments),
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
            + self._credit_payments_total()
            - self._completed_returns_total()
            - self._expenses_total()
            - self._supplier_cash_payments_total()
        )

    def _payload_hash(self, action_name, amount, note):
        payload = json.dumps({
            'action': action_name,
            'amount': str(amount),
            'note': str(note).strip(),
        }, sort_keys=True, separators=(',', ':')).encode('utf-8')
        return hashlib.sha256(payload).hexdigest()

    def _lock_and_find_operation(self, operation_id, payload_hash):
        CashRegisterState.objects.get_or_create(pk=1)
        CashRegisterState.objects.select_for_update().get(pk=1)
        if not operation_id:
            return None
        existing = CashRegisterAdjustment.objects.filter(
            operation_id=operation_id,
        ).first()
        if not existing:
            return None
        if existing.operation_payload_hash != payload_hash:
            return Response(
                {'operation_id': [
                    'Cet identifiant a deja ete utilise avec une autre operation.'
                ]},
                status=status.HTTP_409_CONFLICT,
            )
        return existing

    def _cash_sales_total(self):
        return (
            Sale.objects.filter(payment_method=Sale.PaymentMethod.CASH)
            .aggregate(total=Sum('total_ttc'))['total']
            or Decimal('0')
        )

    def _credit_payments_total(self):
        try:
            from credit.models import CreditPayment
        except Exception:
            return Decimal('0')
        return (
            CreditPayment.objects.filter(
                status=CreditPayment.PaymentStatus.ACTIVE,
            ).aggregate(total=Sum('amount'))['total']
            or Decimal('0')
        )

    def _completed_returns_total(self):
        return (
            Return.objects.filter(
                status=Return.ReturnStatus.COMPLETED,
                refund_method=Sale.PaymentMethod.CASH,
            )
            .aggregate(total=Sum('cash_refund_amount'))['total']
            or Decimal('0')
        )

    def _expenses_total(self):
        return (
            Expense.objects.filter(paid_from_cash=True)
            .aggregate(total=Sum('amount'))['total']
            or Decimal('0')
        )

    def _supplier_cash_payments_total(self):
        return (
            SupplierPayment.objects.filter(
                method=SupplierPayment.PaymentMethod.CASH,
                status=SupplierPayment.PaymentStatus.ACTIVE,
            ).aggregate(total=Sum('amount'))['total']
            or Decimal('0')
        )

    def _adjustments_total(self, adjustment_type=None):
        qs = CashRegisterAdjustment.objects.all()
        if adjustment_type:
            qs = qs.filter(adjustment_type=adjustment_type)
        return qs.aggregate(total=Sum('amount'))['total'] or Decimal('0')


class CashierExpenseView(APIView):
    """Saisie simplifiee des depenses par vendeur.

    Le vendeur ne voit aucun chiffre comptable. Il peut seulement recuperer les
    categories et creer une depense payee depuis la caisse.
    """
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ExpenseCategorySerializer(many=True))
    def get(self, request):
        categories = ExpenseCategory.objects.exclude(
            name=MANAGER_WITHDRAWAL_CATEGORY,
        ).order_by('name')
        return Response(ExpenseCategorySerializer(categories, many=True).data)

    @extend_schema(
        request=CashierExpenseCreateSerializer,
        responses={201: ExpenseSerializer},
    )
    def post(self, request):
        input_serializer = CashierExpenseCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        expense_data = input_serializer.validated_data
        amount = expense_data['amount']

        category_id = expense_data['category']
        try:
            category = ExpenseCategory.objects.get(pk=category_id)
        except (ExpenseCategory.DoesNotExist, ValueError, TypeError):
            return Response(
                {'category': ['Categorie invalide.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if category.name == MANAGER_WITHDRAWAL_CATEGORY:
            return Response(
                {
                    'category': [
                        'Cette categorie est reservee au retrait gere par un administrateur.'
                    ],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        incurred_on = expense_data.get('incurred_on', timezone.localdate())
        description = expense_data.get('description', '')
        operation_id = expense_data.get('operation_id')
        payload_hash = ''

        try:
            with transaction.atomic():
                category = ExpenseCategory.objects.select_for_update().get(
                    pk=category.pk,
                )
                if category.name == MANAGER_WITHDRAWAL_CATEGORY:
                    return Response(
                        {'category': ['Cette catégorie est réservée à un administrateur.']},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                monthly, _ = MonthlyAccounting.objects.get_or_create(
                    year=incurred_on.year,
                    month=incurred_on.month,
                )
                payload_hash = expense_operation_payload_hash(
                    'cashier_expense',
                    monthly_id=monthly.pk,
                    category_id=category.pk,
                    amount=amount,
                    description=description,
                    incurred_on=incurred_on,
                    paid_from_cash=True,
                )
                duplicate = lock_and_find_expense_operation(
                    request,
                    operation_id,
                    payload_hash,
                )
                if isinstance(duplicate, Response):
                    return duplicate
                if duplicate is not None:
                    return Response(
                        ExpenseSerializer(duplicate).data,
                        status=status.HTTP_200_OK,
                    )

                expense = Expense.objects.create(
                    monthly=monthly,
                    category=category,
                    amount=amount,
                    description=description,
                    incurred_on=incurred_on,
                    paid_from_cash=True,
                    created_by=request.user,
                    operation_id=operation_id,
                    operation_payload_hash=(payload_hash if operation_id else ''),
                )
                AuditLog.log(
                    user=request.user,
                    action=AuditLog.ActionType.CREATE,
                    model_name='Expense',
                    object_id=expense.id,
                    object_repr=str(expense),
                    request=request,
                )
        except IntegrityError:
            existing = find_expense_after_integrity_error(
                request,
                operation_id,
                payload_hash,
            )
            if existing is not None:
                return Response(
                    ExpenseSerializer(existing).data,
                    status=status.HTTP_200_OK,
                )
            return Response(
                {'operation_id': ['Identifiant de dépense déjà utilisé.']},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)

class YearSummaryView(APIView):
    """Synthèse annuelle: par mois, par trimestre, par catégorie."""
    permission_classes = [IsAuthenticated, IsAdminRole]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        try:
            year = int(request.query_params.get('year', timezone.localdate().year))
            date(year, 1, 1)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Annee invalide.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        monthly_qs = MonthlyAccounting.objects.filter(year=year).prefetch_related(
            'expenses', 'expenses__category'
        )
        by_month = {m.month: m for m in monthly_qs}

        months = []
        for m in range(1, 13):
            entry = by_month.get(m)
            withdrawal = float(sync_manager_withdrawal(entry)) if entry else 0.0
            expenses_total = (
                float(sum(e.amount for e in entry.expenses.all())) if entry else 0.0
            )
            revenue = float(revenue_for_month(year, m))
            last_day = monthrange(year, m)[1]
            gross_margin = float(gross_margin_for_period(
                _date(year, m, 1), _date(year, m, last_day)
            ))
            net_profit = gross_margin - expenses_total
            supplier_payments = float(supplier_payments_for_period(
                _date(year, m, 1),
                _date(year, m, last_day),
            ))
            months.append({
                'month': m,
                'label': date(year, m, 1).strftime('%b'),
                'revenue': revenue,
                'gross_margin': gross_margin,
                'manager_withdrawal': withdrawal,
                'expenses': expenses_total,
                'supplier_payments': supplier_payments,
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
                'supplier_payments': sum(x['supplier_payments'] for x in qmonths),
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
            'supplier_payments': sum(m['supplier_payments'] for m in months),
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

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        period_type = request.query_params.get('type', 'day')
        raw_date = request.query_params.get('date')
        try:
            target = (
                date.fromisoformat(raw_date)
                if raw_date
                else timezone.localdate()
            )
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Date invalide. Format attendu: AAAA-MM-JJ.'},
                status=status.HTTP_400_BAD_REQUEST,
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
        supplier_payments_by_day = self._supplier_payments_by_day(start, end)

        # Quote-part journalière des dépenses non-datées (calcul Python pur)
        undated_share_by_day = self._undated_share_by_day(start, end)

        # Totaux période
        revenue = sum(revenue_by_day.values(), Decimal('0'))
        gross_margin = sum(margin_by_day.values(), Decimal('0'))
        dated_total = sum(dated_expenses_by_day.values(), Decimal('0'))
        undated_total = sum(undated_share_by_day.values(), Decimal('0'))
        expenses = dated_total + undated_total
        net_profit = gross_margin - expenses
        supplier_payments = sum(
            supplier_payments_by_day.values(),
            Decimal('0'),
        )

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
                day_supplier_payments = supplier_payments_by_day.get(
                    day,
                    Decimal('0'),
                )
                daily.append({
                    'date': day.isoformat(),
                    'label': day.strftime('%a %d/%m'),
                    'revenue': float(day_revenue),
                    'gross_margin': float(day_margin),
                    'expenses': float(day_expenses),
                    'supplier_payments': float(day_supplier_payments),
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
            'supplier_payments': float(supplier_payments),
            'net_profit': float(net_profit),
            'expenses_detail': expenses_detail,
            'category_breakdown': category_breakdown,
            'daily': daily,
            'sales_margin_detail': sales_margin_analytics(start, end),
        })

    # ---- Helpers agrégés ----

    def _supplier_payments_by_day(self, start, end):
        rows = (
            SupplierPayment.objects.filter(
                status=SupplierPayment.PaymentStatus.ACTIVE,
                paid_on__gte=start,
                paid_on__lte=end,
            )
            .values('paid_on')
            .annotate(total=Sum('amount'))
        )
        return {row['paid_on']: row['total'] for row in rows}

    def _revenue_by_day(self, start, end):
        start_dt, end_dt = local_datetime_bounds(start, end)
        tz = timezone.get_current_timezone()
        rows = (
            Sale.objects.filter(
                created_at__gte=start_dt,
                created_at__lte=end_dt,
            )
            .exclude(payment_method=Sale.PaymentMethod.CREDIT)
            .annotate(d=TruncDate('created_at', tzinfo=tz))
            .values('d')
            .annotate(total=Sum('total_ttc'))
        )
        result = {row['d']: row['total'] or Decimal('0') for row in rows}
        refunds_by_day, _ = recognized_return_effects_by_day(start, end)
        for day, refund in refunds_by_day.items():
            result[day] = result.get(day, Decimal('0')) - refund
        for d, amount in self._credit_payments_by_day(start, end).items():
            result[d] = result.get(d, Decimal('0')) + amount
        return result

    def _gross_margin_by_day(self, start, end):
        # Marge brute = (vente - achat) - remise, agrégée par jour.
        # Les ventes à crédit sont exclues ; les règlements sont comptés à leur date
        # avec leur coût d'achat au prorata.
        start_dt, end_dt = local_datetime_bounds(start, end)
        tz = timezone.get_current_timezone()
        items = (
            SaleItem.objects.filter(
                sale__created_at__gte=start_dt,
                sale__created_at__lte=end_dt,
            )
            .exclude(sale__payment_method=Sale.PaymentMethod.CREDIT)
            .annotate(d=TruncDate('sale__created_at', tzinfo=tz))
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
        # Soustraire les remises par jour (hors crédit)
        discounts = (
            Sale.objects.filter(
                created_at__gte=start_dt,
                created_at__lte=end_dt,
            )
            .exclude(payment_method=Sale.PaymentMethod.CREDIT)
            .annotate(d=TruncDate('created_at', tzinfo=tz))
            .values('d')
            .annotate(total=Sum('discount_amount'))
        )
        for row in discounts:
            margin[row['d']] = margin.get(row['d'], Decimal('0')) - (
                row['total'] or Decimal('0')
            )
        refunds_by_day, returned_costs_by_day = (
            recognized_return_effects_by_day(start, end)
        )
        for day, refund in refunds_by_day.items():
            margin[day] = margin.get(day, Decimal('0')) - refund
        for day, returned_cost in returned_costs_by_day.items():
            margin[day] = margin.get(day, Decimal('0')) + returned_cost
        payments_by_day = self._credit_payments_by_day(start, end)
        costs_by_day = self._credit_payment_costs_by_day(start, end)
        for d, amount in payments_by_day.items():
            margin[d] = margin.get(d, Decimal('0')) + amount
        for d, cost in costs_by_day.items():
            margin[d] = margin.get(d, Decimal('0')) - cost
        return margin

    def _credit_payments_by_day(self, start, end):
        try:
            from credit.models import CreditPayment
        except Exception:
            return {}
        start_dt, end_dt = local_datetime_bounds(start, end)
        tz = timezone.get_current_timezone()
        rows = (
            CreditPayment.objects.filter(
                created_at__gte=start_dt,
                created_at__lte=end_dt,
                status=CreditPayment.PaymentStatus.ACTIVE,
            )
            .annotate(d=TruncDate('created_at', tzinfo=tz))
            .values('d')
            .annotate(total=Sum('amount'))
        )
        return {row['d']: row['total'] or Decimal('0') for row in rows}

    def _credit_payment_costs_by_day(self, start, end):
        """Coût d'achat reconnu au prorata des règlements, regroupé par jour.

        On somme en pleine précision et on arrondit par jour pour éviter
        la dérive cumulée sur de nombreux petits règlements.
        """
        try:
            from credit.models import CreditPayment
        except Exception:
            return {}
        start_dt, end_dt = local_datetime_bounds(start, end)
        tz = timezone.get_current_timezone()
        payments = list(
            CreditPayment.objects.filter(
                created_at__gte=start_dt,
                created_at__lte=end_dt,
                status=CreditPayment.PaymentStatus.ACTIVE,
            )
            .select_related('credit_sale__sale')
            .annotate(d=TruncDate('created_at', tzinfo=tz))
        )
        if not payments:
            return {}
        sale_ids = {p.credit_sale.sale_id for p in payments}
        cost_by_sale = {
            row['sale_id']: row['total'] or Decimal('0')
            for row in SaleItem.objects.filter(sale_id__in=sale_ids)
            .values('sale_id')
            .annotate(total=Sum('total_purchase_cost'))
        }
        accumulator = {}
        for payment in payments:
            sale = payment.credit_sale.sale
            sale_total = sale.total_ttc or Decimal('0')
            if sale_total <= 0:
                continue
            ratio = (payment.amount or Decimal('0')) / sale_total
            cost = cost_by_sale.get(sale.id, Decimal('0')) * ratio
            accumulator[payment.d] = accumulator.get(payment.d, Decimal('0')) + cost
        return {
            d: total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            for d, total in accumulator.items()
        }

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
                    days_overlap = (eff_end - eff_start).days + 1
                    period_share = (
                        month_undated
                        * Decimal(days_overlap)
                        / Decimal(days_in_month)
                    ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                    base_share = (
                        period_share / Decimal(days_overlap)
                    ).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
                    residual_cents = int(
                        (period_share - base_share * days_overlap)
                        / Decimal('0.01')
                    )
                    d = eff_start
                    for offset in range(days_overlap):
                        daily_share = base_share
                        if offset < residual_cents:
                            daily_share += Decimal('0.01')
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
