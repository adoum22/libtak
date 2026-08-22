import hashlib
import json
import re

from django.db import transaction
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

from accounting.models import CashRegisterState
from core.models import AuditLog
from core.permissions import IsAdminRole

from .models import CreditPayment, CreditSale, Customer
from .serializers import (
    CreditPaymentCreateSerializer,
    CreditPaymentReverseSerializer,
    CreditSaleDetailSerializer,
    CreditSaleListSerializer,
    CustomerSerializer,
)


class CustomerWritePermission(permissions.BasePermission):
    """Tout utilisateur authentifié peut lister/créer un client (POS crédit).
    Seuls les admins peuvent modifier ou supprimer un client existant
    (un vendeur ne doit pas pouvoir corrompre la base clients)."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS or request.method == 'POST':
            return True
        return getattr(request.user, 'is_admin_role', False) or getattr(
            request.user, 'role', None,
        ) == 'ADMIN'


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().prefetch_related(
        'credit_sales__sale__returns',
    )
    serializer_class = CustomerSerializer
    permission_classes = [CustomerWritePermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']


class CreditSaleViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CreditSale.objects.select_related('customer', 'sale')
        .prefetch_related(
            'sale__items',
            'sale__returns',
            'payments',
            'payments__created_by',
            'payments__reversed_by',
        )
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

    def _operation_id(self, request, validated_data):
        body_operation_id = validated_data.get('operation_id')
        header_operation_id = request.headers.get('Idempotency-Key')
        if (
            body_operation_id
            and header_operation_id
            and body_operation_id != header_operation_id
        ):
            raise ValidationError({
                'operation_id': [
                    "L'identifiant du corps et l'en-tête Idempotency-Key doivent correspondre."
                ],
            })
        operation_id = body_operation_id or header_operation_id
        if not operation_id:
            raise ValidationError({
                'operation_id': [
                    'Un identifiant idempotent valide (8 à 64 caractères) est obligatoire.'
                ],
            })
        if not re.fullmatch(r'[A-Za-z0-9._:-]{8,64}', operation_id):
            raise ValidationError({
                'operation_id': [
                    'Utilisez 8 à 64 lettres, chiffres ou caractères . _ : -.'
                ],
            })
        return operation_id

    def _payload_hash(self, payload):
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        ).encode('utf-8')
        return hashlib.sha256(canonical).hexdigest()

    def _lock_cash_register(self):
        """Sérialise règlements/contrepassations avec le comptage physique."""
        CashRegisterState.objects.get_or_create(pk=1)
        CashRegisterState.objects.select_for_update().get(pk=1)

    def _sync_credit_state(self, credit):
        return credit.synchronize_from_ledger()

    def _detail_response(self, credit_id, *, http_status):
        credit = self.get_queryset().get(pk=credit_id)
        return Response(
            CreditSaleDetailSerializer(
                credit,
                context=self.get_serializer_context(),
            ).data,
            status=http_status,
        )

    @extend_schema(
        request=CreditPaymentCreateSerializer,
        responses={
            200: CreditSaleDetailSerializer,
            201: CreditSaleDetailSerializer,
        },
    )
    @action(detail=True, methods=['post'])
    def pay(self, request, pk=None):
        """Enregistre un règlement (partiel ou total) sur un crédit."""
        input_serializer = CreditPaymentCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payment_data = input_serializer.validated_data
        operation_id = self._operation_id(request, payment_data)

        try:
            credit_id = int(pk)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'ID de crédit invalide.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        amount = payment_data['amount']
        note = payment_data.get('note', '').strip()
        payload_hash = self._payload_hash({
            'credit_id': credit_id,
            'amount': format(amount, 'f'),
            'note': note,
        })

        with transaction.atomic():
            self._lock_cash_register()
            try:
                credit = (
                    CreditSale.objects.select_for_update()
                    .select_related('sale')
                    .get(pk=credit_id)
                )
            except CreditSale.DoesNotExist:
                return Response(
                    {'detail': 'Crédit introuvable.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            existing = CreditPayment.objects.select_for_update().filter(
                operation_id=operation_id,
            ).first()
            if existing:
                if (
                    existing.credit_sale_id != credit.id
                    or existing.operation_payload_hash != payload_hash
                ):
                    return Response(
                        {'operation_id': [
                            'Cet identifiant a déjà été utilisé avec un autre règlement.'
                        ]},
                        status=status.HTTP_409_CONFLICT,
                    )
                self._sync_credit_state(credit)
                replay = True
            else:
                ledger = self._sync_credit_state(credit)
                remaining = ledger['adjusted_total'] - ledger['net_paid']
                if remaining <= 0:
                    return Response(
                        {'detail': 'Ce crédit est déjà entièrement réglé.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
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
                    note=note,
                    created_by=request.user,
                    operation_id=operation_id,
                    operation_payload_hash=payload_hash,
                )
                self._sync_credit_state(credit)
                AuditLog.log(
                    user=request.user,
                    action=AuditLog.ActionType.CREATE,
                    model_name='CreditPayment',
                    object_id=payment.id,
                    object_repr=f"Règlement crédit #{credit.id}: {amount}",
                    changes={
                        'credit_id': credit.id,
                        'amount': str(amount),
                        'note': note,
                        'operation_id': operation_id,
                    },
                    request=request,
                )
                replay = False

        return self._detail_response(
            credit_id,
            http_status=(
                status.HTTP_200_OK if replay else status.HTTP_201_CREATED
            ),
        )

    @extend_schema(
        request=CreditPaymentReverseSerializer,
        responses={200: CreditSaleDetailSerializer},
    )
    @action(
        detail=True,
        methods=['post'],
        url_path=r'payments/(?P<payment_id>\d+)/reverse',
        permission_classes=[permissions.IsAuthenticated, IsAdminRole],
    )
    def reverse_payment(self, request, pk=None, payment_id=None):
        """Contrepasse un règlement sans supprimer son historique."""
        input_serializer = CreditPaymentReverseSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        reversal_data = input_serializer.validated_data
        operation_id = self._operation_id(request, reversal_data)

        try:
            credit_id = int(pk)
            resolved_payment_id = int(payment_id)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'ID de crédit ou de règlement invalide.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        reason = reversal_data['reason'].strip()
        payload_hash = self._payload_hash({
            'credit_id': credit_id,
            'payment_id': resolved_payment_id,
            'reason': reason,
        })

        with transaction.atomic():
            self._lock_cash_register()
            try:
                credit = (
                    CreditSale.objects.select_for_update()
                    .select_related('sale')
                    .get(pk=credit_id)
                )
                payment = CreditPayment.objects.select_for_update().get(
                    pk=resolved_payment_id,
                    credit_sale=credit,
                )
            except (CreditSale.DoesNotExist, CreditPayment.DoesNotExist):
                return Response(
                    {'detail': 'Crédit ou règlement introuvable.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            reused_operation = CreditPayment.objects.select_for_update().filter(
                reversal_operation_id=operation_id,
            ).exclude(pk=payment.pk).exists()
            if reused_operation:
                return Response(
                    {'operation_id': [
                        'Cet identifiant a déjà été utilisé pour une autre contrepassation.'
                    ]},
                    status=status.HTTP_409_CONFLICT,
                )

            ledger_before = self._sync_credit_state(credit)
            if payment.status == CreditPayment.PaymentStatus.REVERSED:
                if (
                    payment.reversal_operation_id == operation_id
                    and payment.reversal_payload_hash == payload_hash
                ):
                    self._sync_credit_state(credit)
                else:
                    return Response(
                        {'detail': 'Ce règlement a déjà été contrepassé.'},
                        status=status.HTTP_409_CONFLICT,
                    )
            else:
                if (
                    ledger_before['gross_paid'] - payment.amount
                    < ledger_before['cash_refunded']
                ):
                    return Response(
                        {
                            'detail': (
                                'Ce règlement finance déjà un remboursement client. '
                                'Il ne peut plus être contrepassé intégralement.'
                            ),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )
                payment.status = CreditPayment.PaymentStatus.REVERSED
                payment.reversed_by = request.user
                payment.reversed_at = timezone.now()
                payment.reversal_reason = reason
                payment.reversal_operation_id = operation_id
                payment.reversal_payload_hash = payload_hash
                payment.save(update_fields=[
                    'status',
                    'reversed_by',
                    'reversed_at',
                    'reversal_reason',
                    'reversal_operation_id',
                    'reversal_payload_hash',
                ])
                self._sync_credit_state(credit)
                AuditLog.log(
                    user=request.user,
                    action=AuditLog.ActionType.UPDATE,
                    model_name='CreditPayment',
                    object_id=payment.id,
                    object_repr=(
                        f"Contrepassation règlement crédit #{credit.id}: {payment.amount}"
                    ),
                    changes={
                        'status': {
                            'before': CreditPayment.PaymentStatus.ACTIVE,
                            'after': CreditPayment.PaymentStatus.REVERSED,
                        },
                        'reason': reason,
                        'paid_amount': {
                            'before': str(ledger_before['net_paid']),
                            'after': str(credit.paid_amount),
                        },
                        'operation_id': operation_id,
                    },
                    request=request,
                )

        return self._detail_response(
            credit_id,
            http_status=status.HTTP_200_OK,
        )
