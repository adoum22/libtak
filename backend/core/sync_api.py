"""
API endpoints for data synchronization between local and cloud servers.
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.response import Response
from django.conf import settings
from django.db import transaction
from django.utils import timezone
import logging

from sales.models import Sale, SaleItem, Return, ReturnItem
from inventory.models import Product, Category, Supplier
from .permissions import IsAdminRole

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# S-13: SyncTokenPermission now properly extends BasePermission so it
# integrates with DRF's permission system. The manual token-check blocks
# that were duplicated in every view have been removed.
# ---------------------------------------------------------------------------

class SyncTokenPermission(BasePermission):
    """
    Server-to-server authentication via a shared SYNC_TOKEN.
    Expected header: Authorization: SyncToken <token>

    Returns 403 (not 401) when the token is wrong so clients can distinguish
    "no credentials" (401 from IsAuthenticated) from "wrong credentials" (403).
    """
    message = 'Invalid or missing sync token.'

    def has_permission(self, request, view):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('SyncToken '):
            return False
        token = auth_header[10:]
        expected = getattr(settings, 'SYNC_TOKEN', None)
        # expected is None when SYNC_TOKEN env var is not set → always deny
        return bool(expected and token == expected)


# ---------------------------------------------------------------------------
# Sync endpoints
# ---------------------------------------------------------------------------

@api_view(['POST'])
@permission_classes([SyncTokenPermission])
def receive_sync_data(request):
    """
    Receive sales/returns/stock data pushed from the local server.
    Runs on the cloud server only.
    """
    data = request.data

    try:
        with transaction.atomic():
            sales_created = 0
            for sale_data in data.get('sales', []):
                if _import_sale(sale_data):
                    sales_created += 1

            returns_created = 0
            for return_data in data.get('returns', []):
                if _import_return(return_data):
                    returns_created += 1

            stock_updates = data.get('stock_updates', [])
            for stock_update in stock_updates:
                _update_cloud_stock_reference(stock_update)

        return Response({
            'status': 'success',
            'sales_created': sales_created,
            'returns_created': returns_created,
            'stock_updates_received': len(stock_updates),
            'sync_time': timezone.now().isoformat(),
        })

    except Exception as e:
        logger.error(f"Sync receive error: {e}")
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _import_sale(sale_data: dict) -> bool:
    """
    Import a sale from the local server.

    S-18: Deduplication uses sale_data['local_id'] — a stable UUID generated
    by the local POS. If local_id is absent the record is rejected (prevents
    silent duplicates from old clients). created_at is no longer used for
    deduplication because two sales at the exact same millisecond would be
    silently dropped.
    """
    local_id = sale_data.get('local_id')
    if not local_id:
        logger.warning("Skipping sale without local_id — upgrade the local server.")
        return False

    # Idempotent: skip if already imported
    if Sale.objects.filter(local_id=local_id).exists():
        return False

    from core.models import User
    user = None
    if sale_data.get('user_username'):
        user = User.objects.filter(username=sale_data['user_username']).first()

    sale = Sale.objects.create(
        local_id=local_id,
        user=user,
        total_ht=sale_data['total_ht'],
        total_tva=0,
        total_ttc=sale_data['total_ttc'],
        payment_method=sale_data.get('payment_method', 'CASH'),
        synced=True,
    )

    # Preserve the original timestamp from the local server
    Sale.objects.filter(id=sale.id).update(created_at=sale_data['created_at'])

    for item_data in sale_data.get('items', []):
        product = Product.objects.filter(barcode=item_data['product_barcode']).first()
        SaleItem.objects.create(
            sale=sale,
            product=product,
            product_name=item_data['product_name'],
            quantity=item_data['quantity'],
            unit_price_ht=item_data['unit_price_ht'],
            total_price_ht=item_data['total_ht'],
            tva_rate=item_data.get('tva_rate', 20),
        )

    return True


def _import_return(return_data: dict) -> bool:
    """Import a return from the local server. Uses local_id for deduplication."""
    local_id = return_data.get('local_id')
    if not local_id:
        logger.warning("Skipping return without local_id.")
        return False

    if Return.objects.filter(local_id=local_id).exists():
        return False

    # Find the corresponding sale by its local_id
    sale_local_id = return_data.get('sale_local_id')
    sale = None
    if sale_local_id:
        sale = Sale.objects.filter(local_id=sale_local_id).first()
    # Fallback: try matching by created_at (legacy clients)
    if not sale and return_data.get('sale_created_at'):
        sale = Sale.objects.filter(created_at=return_data['sale_created_at']).first()

    if not sale:
        logger.warning(f"Could not find sale for return {local_id}")
        return False

    ret = Return.objects.create(
        local_id=local_id,
        sale=sale,
        reason=return_data['reason'],
        refund_amount=return_data['total_refund'],
        status=return_data.get('status', 'COMPLETED'),
        synced=True,
    )
    Return.objects.filter(id=ret.id).update(created_at=return_data['created_at'])
    return True


def _update_cloud_stock_reference(stock_data: dict):
    """Update stock reference on cloud for reporting (local is authoritative)."""
    barcode = stock_data.get('barcode')
    if not barcode:
        return
    product = Product.objects.filter(barcode=barcode).first()
    if product:
        product.stock = stock_data.get('stock', product.stock)
        product.save(update_fields=['stock', 'updated_at'])


@api_view(['GET'])
@permission_classes([SyncTokenPermission])
def get_master_data(request):
    """
    Provide master data (products, categories, suppliers) to the local server.
    Runs on the cloud server only.
    """
    since = request.query_params.get('since')

    categories = list(Category.objects.all().values('name', 'description'))
    suppliers = list(Supplier.objects.all().values('name', 'email', 'phone', 'address'))

    products_qs = Product.objects.select_related('category').all()
    if since:
        try:
            from datetime import datetime
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            products_qs = products_qs.filter(updated_at__gt=since_dt)
        except (ValueError, TypeError):
            pass

    products = [
        {
            'barcode': p.barcode,
            'name': p.name,
            'category_name': p.category.name if p.category else None,
            'purchase_price': str(p.purchase_price),
            'sale_price_ht': str(p.sale_price_ht),
            'tva': str(p.tva),
            'stock': p.stock,
            'min_stock': p.min_stock,
        }
        for p in products_qs
    ]

    return Response({
        'categories': categories,
        'suppliers': suppliers,
        'products': products,
        'timestamp': timezone.now().isoformat(),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_status(request):
    """Return current sync status for the UI."""
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
        'is_local_server': not getattr(settings, 'IS_CLOUD_SERVER', False),
    })


# Q-01: Replaced inline `if not request.user.role == 'ADMIN'` check with
# the IsAdminRole permission class, consistent with the rest of the codebase.
@api_view(['POST'])
@permission_classes([IsAuthenticated, IsAdminRole])
def trigger_sync(request):
    """Manually trigger a full sync (admin only)."""
    from core.sync_service import sync_service
    result = sync_service.full_sync()
    return Response(result)
