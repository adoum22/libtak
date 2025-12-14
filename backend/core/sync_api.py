"""
API endpoints for data synchronization between local and cloud servers.
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.conf import settings
from django.db import transaction
from django.utils import timezone
import logging

from sales.models import Sale, SaleItem, Return, ReturnItem
from inventory.models import Product, Category, Supplier

logger = logging.getLogger(__name__)


class SyncTokenPermission:
    """
    Permission class that checks for valid sync token.
    Used for server-to-server sync authentication.
    """
    def has_permission(self, request, view):
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('SyncToken '):
            token = auth_header[10:]
            expected_token = getattr(settings, 'SYNC_TOKEN', None)
            return token and token == expected_token
        return False


@api_view(['POST'])
@permission_classes([AllowAny])  # Uses custom token auth
def receive_sync_data(request):
    """
    Endpoint for receiving sync data from local server.
    This runs on the cloud server.
    """
    # Verify sync token
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('SyncToken '):
        return Response({'error': 'Invalid authorization'}, status=status.HTTP_401_UNAUTHORIZED)
    
    token = auth_header[10:]
    expected_token = getattr(settings, 'SYNC_TOKEN', None)
    
    if not expected_token or token != expected_token:
        return Response({'error': 'Invalid sync token'}, status=status.HTTP_401_UNAUTHORIZED)
    
    data = request.data
    
    try:
        with transaction.atomic():
            # Process incoming sales
            sales_created = 0
            for sale_data in data.get('sales', []):
                sale_created = _import_sale(sale_data)
                if sale_created:
                    sales_created += 1
            
            # Process incoming returns
            returns_created = 0
            for return_data in data.get('returns', []):
                return_created = _import_return(return_data)
                if return_created:
                    returns_created += 1
            
            # Process stock updates (just log them, local is authority for stock)
            stock_updates = data.get('stock_updates', [])
            for stock_update in stock_updates:
                _update_cloud_stock_reference(stock_update)
        
        return Response({
            'status': 'success',
            'sales_created': sales_created,
            'returns_created': returns_created,
            'stock_updates_received': len(stock_updates),
            'sync_time': timezone.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Sync receive error: {e}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _import_sale(sale_data: dict) -> bool:
    """Import a sale from local server."""
    # Check if this sale already exists (by local_id)
    local_id = sale_data.get('local_id')
    if not local_id:
        return False
    
    # Use a reference field to track imported sales
    existing = Sale.objects.filter(
        created_at=sale_data['created_at']
    ).first()
    
    if existing:
        return False  # Already imported
    
    from core.models import User
    user = None
    if sale_data.get('user_username'):
        user = User.objects.filter(username=sale_data['user_username']).first()
    
    sale = Sale.objects.create(
        user=user,
        total_ht=sale_data['total_ht'],
        total_tva=0,  # Will be calculated
        total_ttc=sale_data['total_ttc'],
        payment_method=sale_data.get('payment_method', 'CASH'),
        synced=True  # Mark as already synced
    )
    
    # Override created_at
    Sale.objects.filter(id=sale.id).update(created_at=sale_data['created_at'])
    
    # Create sale items
    for item_data in sale_data.get('items', []):
        product = Product.objects.filter(barcode=item_data['product_barcode']).first()
        
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=item_data['product_name'],
            quantity=item_data['quantity'],
            unit_price_ht=item_data['unit_price_ht'],
            total_price_ht=item_data['total_ht'],
            tva_rate=20  # Default
        )
    
    return True


def _import_return(return_data: dict) -> bool:
    """Import a return from local server."""
    # Skip if already imported
    local_id = return_data.get('local_id')
    if not local_id:
        return False
    
    existing = Return.objects.filter(
        created_at=return_data['created_at']
    ).first()
    
    if existing:
        return False
    
    # Find the corresponding sale
    sale = Sale.objects.filter(
        created_at=return_data.get('sale_created_at')
    ).first()
    
    if not sale:
        logger.warning(f"Could not find sale for return {local_id}")
        return False
    
    ret = Return.objects.create(
        sale=sale,
        reason=return_data['reason'],
        refund_amount=return_data['total_refund'],
        status=return_data.get('status', 'COMPLETED'),
        synced=True
    )
    
    Return.objects.filter(id=ret.id).update(created_at=return_data['created_at'])
    
    return True


def _update_cloud_stock_reference(stock_data: dict):
    """
    Update stock reference on cloud (for reporting only).
    Local server is the authority for actual stock levels.
    """
    barcode = stock_data.get('barcode')
    if not barcode:
        return
    
    product = Product.objects.filter(barcode=barcode).first()
    if product:
        # Update cloud's reference of local stock
        product.stock = stock_data.get('stock', product.stock)
        product.save(update_fields=['stock', 'updated_at'])


@api_view(['GET'])
@permission_classes([AllowAny])  # Uses custom token auth  
def get_master_data(request):
    """
    Endpoint for providing master data to local server.
    This runs on the cloud server.
    """
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('SyncToken '):
        return Response({'error': 'Invalid authorization'}, status=status.HTTP_401_UNAUTHORIZED)
    
    token = auth_header[10:]
    expected_token = getattr(settings, 'SYNC_TOKEN', None)
    
    if not expected_token or token != expected_token:
        return Response({'error': 'Invalid sync token'}, status=status.HTTP_401_UNAUTHORIZED)
    
    since = request.query_params.get('since')
    
    # Get master data updated since the given timestamp
    categories = list(Category.objects.all().values('name', 'description'))
    
    suppliers = list(Supplier.objects.all().values(
        'name', 'email', 'phone', 'address'
    ))
    
    products_qs = Product.objects.all()
    if since:
        try:
            from datetime import datetime
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            products_qs = products_qs.filter(updated_at__gt=since_dt)
        except (ValueError, TypeError):
            pass
    
    products = []
    for p in products_qs:
        products.append({
            'barcode': p.barcode,
            'name': p.name,
            'category_name': p.category.name if p.category else None,
            'purchase_price_ht': str(p.purchase_price_ht),
            'sale_price_ht': str(p.sale_price_ht),
            'tva_rate': str(p.tva_rate),
            'stock': p.stock,
            'min_stock': p.min_stock,
        })
    
    return Response({
        'categories': categories,
        'suppliers': suppliers,
        'products': products,
        'timestamp': timezone.now().isoformat()
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_status(request):
    """Get the current sync status for the UI."""
    from core.sync_service import sync_service
    
    last_sync = sync_service.get_last_sync_time()
    pending_sales = Sale.objects.filter(synced=False).count()
    pending_returns = Return.objects.filter(synced=False).count()
    
    cloud_configured = bool(
        getattr(settings, 'CLOUD_API_URL', None) and 
        getattr(settings, 'SYNC_TOKEN', None)
    )
    
    return Response({
        'cloud_configured': cloud_configured,
        'last_sync': last_sync.isoformat() if last_sync else None,
        'pending_sales': pending_sales,
        'pending_returns': pending_returns,
        'is_local_server': not getattr(settings, 'IS_CLOUD_SERVER', False)
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def trigger_sync(request):
    """Manually trigger a sync (admin only)."""
    if not request.user.role == 'ADMIN':
        return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
    
    from core.sync_service import sync_service
    result = sync_service.full_sync()
    
    return Response(result)
