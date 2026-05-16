from decimal import Decimal, InvalidOperation

from django.db import transaction
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.models import AuditLog

from .models import CreditPayment, CreditSale, Customer
from .serializers import (
    CreditPaymentSerializer,
    CreditSaleDetailSerializer,
    CreditSaleListSerializer,
    CustomerSerializer,
)


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().prefetch_related('credit_sales')
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']


class CreditSaleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CreditSale.objects.select_related('customer', 'sale')
        .prefetch_related('sale__items', 'payments', 'payments__created_by')
        .order_by('-created_at')
    )
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'customer']
    search_fields = ['customer__name', 'customer__phone']
    ordering_fields = ['created_at', 'paid_amount']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action in ('retrieve',):
            return CreditSaleDetailSerializer
        return CreditSaleListSerializer

    @action(detail=True, methods=['post'])
    def pay(self, request, pk=None):
        """Enregistre un règlement (partiel ou total) sur un crédit."""
        raw_amount = request.data.get('amount')
        try:
            amount = Decimal(str(raw_amount)).quantize(Decimal('0.01'))
        except (InvalidOperation, TypeError, ValueError):
            return Response(
                {'amount': ['Montant invalide.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if amount <= 0:
            return Response(
                {'amount': ['Le montant doit être positif.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            credit = (
                CreditSale.objects.select_for_update()
                .select_related('sale')
                .get(pk=pk)
            )
            if credit.status == CreditSale.Status.PAID:
                return Response(
                    {'detail': 'Ce crédit est déjà entièrement réglé.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            remaining = credit.remaining_amount
            if amount > remaining:
                return Response(
                    {'amount': [
                        f"Le règlement ne peut pas dépasser le restant dû ({remaining} DH)."
                    ]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            payment = CreditPayment.objects.create(
                credit_sale=credit,
                amount=amount,
                note=request.data.get('note') or '',
                created_by=request.user,
            )
            credit.paid_amount = (credit.paid_amount or Decimal('0')) + amount
            if credit.paid_amount >= (credit.sale.total_ttc or Decimal('0')):
                credit.status = CreditSale.Status.PAID
            else:
                credit.status = CreditSale.Status.PARTIAL
            credit.save(update_fields=['paid_amount', 'status', 'updated_at'])

        AuditLog.log(
            user=request.user,
            action=AuditLog.ActionType.CREATE,
            model_name='CreditPayment',
            object_id=payment.id,
            object_repr=f"Règlement crédit #{credit.id}: {amount}",
            request=request,
        )

        credit.refresh_from_db()
        return Response(
            CreditSaleDetailSerializer(credit).data,
            status=status.HTTP_201_CREATED,
        )
