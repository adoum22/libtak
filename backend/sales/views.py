from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.utils import timezone
from core.models import AuditLog
from core.permissions import IsAdminRole
from .models import Sale, Discount, Return, CashRegisterSession
from .serializers import (
    SaleSerializer, SaleDetailSerializer,
    DiscountSerializer, DiscountApplySerializer,
    ReturnSerializer,
    CashRegisterSessionSerializer, CashRegisterCloseSerializer,
)


class SaleViewSet(viewsets.ModelViewSet):
    queryset = Sale.objects.all().order_by('-created_at')
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['payment_method', 'user']
    ordering_fields = ['created_at', 'total_ttc']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return SaleDetailSerializer
        return SaleSerializer

    def perform_create(self, serializer):
        sale = serializer.save(user=self.request.user)
        # S-17: log every sale for audit trail
        AuditLog.log(
            user=self.request.user,
            action=AuditLog.ActionType.SALE,
            model_name='Sale',
            object_id=sale.id,
            object_repr=str(sale),
            changes={'total_ttc': str(sale.total_ttc), 'payment_method': sale.payment_method},
            request=self.request,
        )


class DiscountViewSet(viewsets.ModelViewSet):
    """API for managing discounts and promotions"""
    queryset = Discount.objects.all()
    serializer_class = DiscountSerializer
    permission_classes = [permissions.IsAuthenticated]
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
    
    @action(detail=False, methods=['post'])
    def apply(self, request):
        """Apply a discount code and calculate the discount amount"""
        serializer = DiscountApplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        discount = Discount.objects.get(code__iexact=serializer.validated_data['code'])
        subtotal = serializer.validated_data['subtotal']
        discount_amount = discount.calculate_discount(subtotal)
        
        return Response({
            'discount': DiscountSerializer(discount).data,
            'discount_amount': discount_amount,
            'new_total': subtotal - discount_amount
        })
    
    @action(detail=True, methods=['post'])
    def use(self, request, pk=None):
        """Increment the usage count of a discount"""
        discount = self.get_object()
        if not discount.is_valid:
            return Response(
                {'error': 'This discount is no longer valid.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        discount.uses_count += 1
        discount.save()
        return Response(DiscountSerializer(discount).data)


class ReturnViewSet(viewsets.ModelViewSet):
    """API for managing product returns"""
    queryset = Return.objects.all().select_related('sale', 'processed_by')
    serializer_class = ReturnSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status', 'sale']
    ordering_fields = ['created_at', 'refund_amount']
    ordering = ['-created_at']
    
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve a return request"""
        return_order = self.get_object()
        if return_order.status != Return.ReturnStatus.PENDING:
            return Response(
                {'error': 'Only pending returns can be approved.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return_order.status = Return.ReturnStatus.APPROVED
        return_order.processed_by = request.user
        return_order.save()
        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=str(return_order), changes={'status': 'APPROVED'},
            request=request,
        )
        return Response(ReturnSerializer(return_order).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject a return request"""
        return_order = self.get_object()
        if return_order.status != Return.ReturnStatus.PENDING:
            return Response(
                {'error': 'Only pending returns can be rejected.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return_order.status = Return.ReturnStatus.REJECTED
        return_order.processed_by = request.user
        return_order.save()

        # Reverse the stock restoration that was done on create
        for item in return_order.items.all():
            if item.sale_item.product:
                item.sale_item.product.stock -= item.quantity
                item.sale_item.product.save()

        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=str(return_order), changes={'status': 'REJECTED'},
            request=request,
        )
        return Response(ReturnSerializer(return_order).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Mark a return as completed (refund processed)"""
        return_order = self.get_object()
        if return_order.status != Return.ReturnStatus.APPROVED:
            return Response(
                {'error': 'Only approved returns can be completed.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return_order.status = Return.ReturnStatus.COMPLETED
        return_order.processed_by = request.user
        return_order.save()
        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=str(return_order), changes={'status': 'COMPLETED'},
            request=request,
        )
        return Response(ReturnSerializer(return_order).data)


class CashRegisterSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Weekly cash register session management.

    - GET  /cash-sessions/          — history (admin/manager only)
    - GET  /cash-sessions/current/  — currently open session (any authenticated user)
    - POST /cash-sessions/open/     — open a new session (admin/manager only)
    - POST /cash-sessions/{id}/close/ — close a session (admin/manager only)
    """
    queryset = CashRegisterSession.objects.select_related('opened_by', 'closed_by').all()
    serializer_class = CashRegisterSessionSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminRole]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['opened_at', 'closed_at']
    ordering = ['-opened_at']

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def current(self, request):
        """Return the currently open session, or 404 if none."""
        session = CashRegisterSession.objects.filter(
            status=CashRegisterSession.SessionStatus.OPEN
        ).select_related('opened_by').first()
        if not session:
            return Response({'detail': 'No open cash register session.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(CashRegisterSessionSerializer(session, context={'request': request}).data)

    @action(detail=False, methods=['post'])
    def open(self, request):
        """Open a new cash register session. Only one session can be open at a time."""
        if CashRegisterSession.objects.filter(status=CashRegisterSession.SessionStatus.OPEN).exists():
            return Response(
                {'error': 'A cash register session is already open. Close it first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CashRegisterSessionSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        session = serializer.save(opened_by=request.user, status=CashRegisterSession.SessionStatus.OPEN)
        AuditLog.log(
            user=request.user,
            action=AuditLog.ActionType.CREATE,
            model_name='CashRegisterSession',
            object_id=session.id,
            object_repr=str(session),
            changes={'opening_amount': str(session.opening_amount)},
            request=request,
        )
        return Response(
            CashRegisterSessionSerializer(session, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        """Close a session with the actual declared cash amount."""
        session = self.get_object()
        if session.status != CashRegisterSession.SessionStatus.OPEN:
            return Response(
                {'error': 'Only open sessions can be closed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = CashRegisterCloseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        actual = serializer.validated_data['actual_declared_amount']
        theoretical = session.theoretical_closing_amount
        variance = actual - theoretical

        session.actual_declared_amount = actual
        session.variance = variance
        session.closed_at = timezone.now()
        session.closed_by = request.user
        session.status = CashRegisterSession.SessionStatus.CLOSED
        session.notes = serializer.validated_data.get('notes', '') or session.notes
        session.save()

        AuditLog.log(
            user=request.user,
            action=AuditLog.ActionType.UPDATE,
            model_name='CashRegisterSession',
            object_id=session.id,
            object_repr=str(session),
            changes={
                'status': 'CLOSED',
                'actual_declared_amount': str(actual),
                'theoretical_closing_amount': str(theoretical),
                'variance': str(variance),
            },
            request=request,
        )
        return Response(CashRegisterSessionSerializer(session, context={'request': request}).data)

