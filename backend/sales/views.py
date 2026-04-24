from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import F
from core.models import AuditLog
from .models import Sale, Discount, Return
from .serializers import (
    SaleSerializer, SaleDetailSerializer,
    DiscountSerializer, DiscountApplySerializer,
    ReturnSerializer
)


class SaleViewSet(viewsets.ModelViewSet):
    queryset = (
        Sale.objects.select_related('user')
        .prefetch_related('items__product')
        .order_by('-created_at')
    )
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
        Discount.objects.filter(pk=discount.pk).update(uses_count=F('uses_count') + 1)
        discount.refresh_from_db()
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
        return_order.save()
        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=f"Return #{return_order.id} -> {return_order.status}",
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
        return_order.save()

        # Restore stock was already done on create, so we need to reverse it
        for item in return_order.items.all():
            if item.sale_item.product:
                item.sale_item.product.stock -= item.quantity
                item.sale_item.product.save()

        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=f"Return #{return_order.id} -> {return_order.status}",
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
        return_order.save()
        AuditLog.log(
            user=request.user, action=AuditLog.ActionType.RETURN,
            model_name='Return', object_id=return_order.id,
            object_repr=f"Return #{return_order.id} -> {return_order.status}",
            request=request,
        )
        return Response(ReturnSerializer(return_order).data)

