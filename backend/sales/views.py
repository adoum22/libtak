from decimal import Decimal, ROUND_HALF_UP

from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db import IntegrityError, transaction
from django.db.models import F, IntegerField, Prefetch, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from core.models import AuditLog
from core.permissions import IsAdminRole
from accounting.models import CashRegisterState
from inventory.models import Product, StockMovement
from .models import Sale, SaleItem, Discount, Return
from .serializers import (
    SaleSerializer, SaleDetailSerializer,
    DiscountSerializer, DiscountApplySerializer,
    ReturnSerializer, return_payload_hash, sale_payload_hash,
)


def _discount_audit_snapshot(discount):
    return {
        'name': discount.name,
        'code': discount.code,
        'discount_type': discount.discount_type,
        'value': str(discount.value),
        'min_purchase': str(discount.min_purchase),
        'max_uses': discount.max_uses,
        'uses_count': discount.uses_count,
        'active': discount.active,
        'start_date': discount.start_date.isoformat() if discount.start_date else None,
        'end_date': discount.end_date.isoformat() if discount.end_date else None,
    }


class SaleViewSet(viewsets.ModelViewSet):
    queryset = (
        Sale.objects.select_related('user')
        .prefetch_related(Prefetch(
            'items',
            queryset=(
                SaleItem.objects.select_related('product')
                .annotate(returned_quantity=Coalesce(
                    Sum(
                        'returnitem__quantity',
                        filter=~Q(
                            returnitem__return_order__status=(
                                Return.ReturnStatus.REJECTED
                            ),
                        ),
                    ),
                    Value(0),
                    output_field=IntegerField(),
                ))
                .order_by('id')
            ),
        ))
        .order_by('-created_at')
    )
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['payment_method', 'user']
    search_fields = ['=id', 'items__product_name', 'items__product__barcode', 'user__username']
    ordering_fields = ['created_at', 'total_ttc']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return SaleDetailSerializer
        return SaleSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_authenticated and not user.is_admin_role:
            queryset = queryset.filter(user=user)
        return queryset.distinct()

    def create(self, request, *args, **kwargs):
        key = request.data.get('idempotency_key')
        if key:
            existing = Sale.objects.filter(local_sync_id=key).first()
            if existing:
                if existing.user_id != request.user.id:
                    return Response(
                        {
                            'detail': (
                                'Cette cle d idempotence est deja utilisee '
                                'pour une autre vente.'
                            ),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                try:
                    request_hash = sale_payload_hash(request.data)
                except (KeyError, TypeError, ValueError):
                    request_hash = None
                if (
                    not request_hash
                    or not existing.idempotency_payload_hash
                    or existing.idempotency_payload_hash != request_hash
                ):
                    return Response(
                        {'detail': 'Cette cle d idempotence est deja utilisee pour une autre vente.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                return Response(
                    SaleSerializer(existing, context=self.get_serializer_context()).data,
                    status=status.HTTP_200_OK,
                )
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            if key:
                existing = Sale.objects.filter(local_sync_id=key).first()
                request_hash = sale_payload_hash(request.data)
                if (
                    existing
                    and existing.user_id == request.user.id
                    and existing.idempotency_payload_hash == request_hash
                ):
                    return Response(
                        SaleSerializer(existing, context=self.get_serializer_context()).data,
                        status=status.HTTP_200_OK,
                    )
                return Response(
                    {
                        'detail': (
                            'Cette cle d idempotence est deja utilisee '
                            'pour une autre vente.'
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            raise

    def perform_create(self, serializer):
        sale = serializer.save(user=self.request.user)
        AuditLog.log(
            user=self.request.user, action=AuditLog.ActionType.SALE,
            model_name='Sale', object_id=sale.id,
            object_repr=f"Sale #{sale.id} - {sale.total_ttc}",
            request=self.request,
        )


class DiscountViewSet(viewsets.ModelViewSet):
    """API for managing discounts and promotions"""
    queryset = Discount.objects.all()
    serializer_class = DiscountSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code']
    ordering_fields = ['created_at', 'value', 'end_date']
    ordering = ['-created_at']

    def get_queryset(self):
        queryset = super().get_queryset()
        # Filter active only if requested
        active_only = self.request.query_params.get('active', None)
        if active_only and active_only.lower() == 'true':
            queryset = queryset.filter(active=True)
        return queryset

    def get_permissions(self):
        if self.action == 'apply':
            return [permissions.IsAuthenticated()]
        return super().get_permissions()

    def perform_create(self, serializer):
        discount = serializer.save()
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.CREATE,
            model_name='Discount',
            object_id=discount.pk,
            object_repr=str(discount),
            changes={'after': _discount_audit_snapshot(discount)},
            request=self.request,
        )

    def perform_update(self, serializer):
        before = _discount_audit_snapshot(serializer.instance)
        discount = serializer.save()
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='Discount',
            object_id=discount.pk,
            object_repr=str(discount),
            changes={
                'before': before,
                'after': _discount_audit_snapshot(discount),
            },
            request=self.request,
        )

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            discount = get_object_or_404(
                Discount.objects.select_for_update(),
                pk=kwargs['pk'],
            )
            self.check_object_permissions(request, discount)
            if discount.uses_count > 0:
                return Response(
                    {
                        'detail': (
                            'Une remise deja utilisee doit etre desactivee '
                            'et ne peut pas etre supprimee.'
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            object_id = discount.pk
            object_repr = str(discount)
            before = _discount_audit_snapshot(discount)
            discount.delete()
            AuditLog.log(
                user=request.user,
                action=AuditLog.ActionType.DELETE,
                model_name='Discount',
                object_id=object_id,
                object_repr=object_repr,
                changes={'before': before},
                request=request,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def apply(self, request):
        """Apply a discount code and calculate the discount amount"""
        serializer = DiscountApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        discount = serializer.discount
        subtotal = serializer.validated_data['subtotal']
        discount_amount = Decimal(
            discount.calculate_discount(subtotal)
        ).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        new_total = (subtotal - discount_amount).quantize(
            Decimal('0.01'),
            rounding=ROUND_HALF_UP,
        )

        return Response({
            'discount': DiscountSerializer(discount).data,
            'discount_amount': discount_amount,
            'new_total': new_total,
        })

    @action(detail=True, methods=['post'])
    def use(self, request, pk=None):
        """Increment the usage count of a discount"""
        with transaction.atomic():
            self.get_object()
            discount = Discount.objects.select_for_update().get(pk=pk)
            if not discount.is_valid:
                return Response(
                    {'error': "Cette remise n'est plus valide."},
                    status=status.HTTP_409_CONFLICT,
                )
            discount.uses_count = F('uses_count') + 1
            discount.save(update_fields=['uses_count'])
            discount.refresh_from_db()
        return Response(DiscountSerializer(discount).data)


class ReturnViewSet(viewsets.ModelViewSet):
    """API for managing product returns"""
    queryset = (
        Return.objects.select_related('sale', 'processed_by')
        .prefetch_related('items__sale_item__product')
    )
    serializer_class = ReturnSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status', 'sale']
    ordering_fields = ['created_at', 'refund_amount']
    ordering = ['-created_at']
    http_method_names = ['get', 'post', 'head', 'options']

    def create(self, request, *args, **kwargs):
        key = request.data.get('idempotency_key')
        if key:
            existing = Return.objects.filter(local_sync_id=key).first()
            if existing:
                if existing.processed_by_id != request.user.id:
                    return Response(
                        {
                            'detail': (
                                'Cette cle d idempotence est deja utilisee '
                                'pour un autre retour.'
                            ),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                try:
                    request_hash = return_payload_hash(request.data)
                except (KeyError, TypeError, ValueError):
                    request_hash = None
                if (
                    not request_hash
                    or not existing.idempotency_payload_hash
                    or existing.idempotency_payload_hash != request_hash
                ):
                    return Response(
                        {'detail': 'Cette cle d idempotence est deja utilisee pour un autre retour.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                return Response(
                    self.get_serializer(existing).data,
                    status=status.HTTP_200_OK,
                )
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            if key:
                existing = Return.objects.filter(local_sync_id=key).first()
                request_hash = return_payload_hash(request.data)
                if (
                    existing
                    and existing.processed_by_id == request.user.id
                    and existing.idempotency_payload_hash == request_hash
                ):
                    return Response(self.get_serializer(existing).data)
                return Response(
                    {
                        'detail': (
                            'Cette cle d idempotence est deja utilisee '
                            'pour un autre retour.'
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            raise

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve a return request"""
        with transaction.atomic():
            self.get_object()
            return_order = get_object_or_404(
                Return.objects.select_for_update()
                .select_related('sale'),
                pk=pk,
            )
            if return_order.status != Return.ReturnStatus.PENDING:
                return Response(
                    {'error': 'Seul un retour en attente peut etre approuve.'},
                    status=status.HTTP_409_CONFLICT,
                )

            items = list(
                return_order.items.select_related('sale_item__product')
                .order_by('id')
            )
            product_ids = sorted({
                item.sale_item.product_id
                for item in items
                if item.restock and item.sale_item.product_id
            })
            products = {
                product.id: product
                for product in Product.objects.select_for_update()
                .filter(id__in=product_ids)
                .order_by('id')
            }
            missing = [
                item.sale_item.product_name
                for item in items
                if item.restock and item.sale_item.product_id not in products
            ]
            if missing:
                return Response(
                    {
                        'error': (
                            'Impossible de remettre en stock les produits supprimes: '
                            + ', '.join(missing)
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            for item in items:
                if not item.restock:
                    continue
                sale_item = item.sale_item
                product = products[sale_item.product_id]
                StockMovement.objects.create(
                    product=product,
                    movement_type=StockMovement.MovementType.RETURN,
                    quantity=item.quantity,
                    unit_cost=sale_item.unit_purchase_price,
                    # Le remboursement conserve le prix historique de la vente,
                    # mais l'exemplaire remis en rayon reprend le prix courant.
                    sale_price=product.sale_price_ht,
                    reference=f'RETOUR-{return_order.id}',
                    notes=f'Retour approuve pour la vente #{return_order.sale_id}.',
                    created_by=request.user,
                )

            now = timezone.now()
            return_order.status = Return.ReturnStatus.APPROVED
            return_order.stock_restored_at = now
            return_order.processed_by = request.user
            return_order.synced = False
            return_order.save(update_fields=[
                'status', 'stock_restored_at', 'processed_by', 'synced', 'updated_at',
            ])
        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=f"Return #{return_order.id} -> {return_order.status}",
            request=request,
        )
        return Response(self.get_serializer(return_order).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject a pending request. Pending returns have no stock effect."""
        with transaction.atomic():
            self.get_object()
            return_order = Return.objects.select_for_update().get(pk=pk)
            if return_order.status != Return.ReturnStatus.PENDING:
                return Response(
                    {'error': 'Seul un retour en attente peut etre rejete.'},
                    status=status.HTTP_409_CONFLICT,
                )
            return_order.status = Return.ReturnStatus.REJECTED
            return_order.processed_by = request.user
            return_order.synced = False
            return_order.save(update_fields=[
                'status', 'processed_by', 'synced', 'updated_at',
            ])

        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=f"Return #{return_order.id} -> {return_order.status}",
            request=request,
        )
        return Response(self.get_serializer(return_order).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark a return as completed (refund processed)"""
        with transaction.atomic():
            # Même verrou que les paiements crédit et le comptage physique :
            # le solde de caisse ne peut pas être figé au milieu du retour.
            CashRegisterState.objects.get_or_create(pk=1)
            CashRegisterState.objects.select_for_update().get(pk=1)
            return_order = (
                Return.objects.select_for_update()
                .select_related('sale')
                .get(pk=pk)
            )
            if return_order.status != Return.ReturnStatus.APPROVED:
                return Response(
                    {'error': 'Seul un retour approuve peut etre rembourse.'},
                    status=status.HTTP_409_CONFLICT,
                )

            credit = None
            credit_changes = None
            if return_order.sale.payment_method == Sale.PaymentMethod.CREDIT:
                from credit.models import CreditSale

                try:
                    credit = (
                        CreditSale.objects.select_for_update()
                        .select_related('sale')
                        .get(sale_id=return_order.sale_id)
                    )
                except CreditSale.DoesNotExist:
                    return Response(
                        {
                            'error': (
                                'Le registre de crédit lié à cette vente est introuvable.'
                            ),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                ledger_before = credit.synchronize_from_ledger()
                overpaid_before = max(
                    ledger_before['net_paid'] - ledger_before['adjusted_total'],
                    Decimal('0.00'),
                )
                adjusted_after = max(
                    ledger_before['adjusted_total'] - return_order.refund_amount,
                    Decimal('0.00'),
                )
                overpaid_after = max(
                    ledger_before['net_paid'] - adjusted_after,
                    Decimal('0.00'),
                )
                return_order.cash_refund_amount = min(
                    max(overpaid_after - overpaid_before, Decimal('0.00')),
                    return_order.refund_amount,
                )
                return_order.refund_method = (
                    Sale.PaymentMethod.CASH
                    if return_order.cash_refund_amount > 0
                    else Sale.PaymentMethod.CREDIT
                )
                credit_changes = {
                    'adjusted_total_before': str(ledger_before['adjusted_total']),
                    'adjusted_total_after': str(adjusted_after),
                    'paid_amount_before': str(ledger_before['net_paid']),
                    'cash_refund_amount': str(return_order.cash_refund_amount),
                }
            else:
                return_order.cash_refund_amount = (
                    return_order.refund_amount
                    if return_order.refund_method == Sale.PaymentMethod.CASH
                    else Decimal('0.00')
                )

            return_order.status = Return.ReturnStatus.COMPLETED
            return_order.completed_at = timezone.now()
            return_order.processed_by = request.user
            return_order.synced = False
            return_order.save(update_fields=[
                'status',
                'refund_method',
                'cash_refund_amount',
                'completed_at',
                'processed_by',
                'synced',
                'updated_at',
            ])
            if credit is not None:
                ledger_after = credit.synchronize_from_ledger()
                credit_changes.update({
                    'paid_amount_after': str(ledger_after['net_paid']),
                    'credit_status_after': credit.status,
                })
            AuditLog.log(
                user=request.user,
                action=AuditLog.ActionType.RETURN,
                model_name='Return',
                object_id=return_order.id,
                object_repr=f"Return #{return_order.id} -> {return_order.status}",
                changes=credit_changes,
                request=request,
            )
        return Response(self.get_serializer(return_order).data)

