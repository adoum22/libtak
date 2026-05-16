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
from django.utils.crypto import constant_time_compare
import logging

from sales.models import Sale, SaleItem, Return, ReturnItem
from inventory.models import Product, Category, Supplier

logger = logging.getLogger(__name__)


class SyncTokenPermission(BasePermission):
    """
    Permission class that checks for a valid sync token using a
    constant-time comparison to avoid timing attacks.
    """
    def has_permission(self, request, view):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('SyncToken '):
            return False
        token = auth_header[len('SyncToken '):]
        expected = getattr(settings, 'SYNC_TOKEN', None)
        if not expected or not token:
            return False
        return constant_time_compare(token, expected)


@api_view(['POST'])
@permission_classes([SyncTokenPermission])
def receive_sync_data(request):
    """
    Endpoint for receiving sync data from local server.
    This runs on the cloud server.
    """
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
    
    except Exception:
        logger.exception("Sync receive failed")
        return Response(
            {'detail': 'Une erreur est survenue lors de la synchronisation.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


def _import_sale(sale_data: dict) -> bool:
    """Import a sale from local server."""
    local_id = sale_data.get('local_id')
    if not local_id:
        return False
    local_id = str(local_id)

    if Sale.objects.filter(local_sync_id=local_id).exists():
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
        discount_amount=sale_data.get('discount_amount', 0),
        payment_method=sale_data.get('payment_method', 'CASH'),
        synced=True,
        local_sync_id=local_id,
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
            unit_price_ht=item_data.get('unit_price_ht', item_data.get('unit_price', 0)),
            total_price_ht=item_data.get('total_ht', 0),
            tva_rate=item_data.get('tva_rate', 20),
            unit_purchase_price=item_data.get('unit_purchase_price', 0),
            total_purchase_cost=item_data.get('total_purchase_cost', 0),
        )
    
    return True


def _import_return(return_data: dict) -> bool:
    """Import a return from local server."""
    local_id = return_data.get('local_id')
    if not local_id:
        return False
    local_id = str(local_id)

    if Return.objects.filter(local_sync_id=local_id).exists():
        return False

    sale_local_id = return_data.get('sale_local_id')
    if sale_local_id:
        sale_local_id = str(sale_local_id)
    sale = None
    if sale_local_id:
        sale = Sale.objects.filter(local_sync_id=sale_local_id).first()
    if not sale:
        sale = Sale.objects.filter(
            created_at=return_data.get('sale_created_at')
        ).first()
    if not sale:
        logger.warning("Could not find sale for return %s", local_id)
        return False

    ret = Return.objects.create(
        sale=sale,
        reason=return_data['reason'],
        refund_amount=return_data['total_refund'],
        status=return_data.get('status', 'COMPLETED'),
        synced=True,
        local_sync_id=local_id,
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
@permission_classes([SyncTokenPermission])
def get_master_data(request):
    """
    Endpoint for providing master data to local server.
    This runs on the cloud server.
    """
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
    for p in products_qs.select_related('category'):
        products.append({
            'barcode': p.barcode,
            'name': p.name,
            'category_name': p.category.name if p.category else None,
            'purchase_price': str(p.purchase_price),
            'sale_price_ht': str(p.sale_price_ht),
            'tva': str(p.tva),
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
@permission_classes([SyncTokenPermission])
def receive_credits_snapshot(request):
    """Endpoint cloud qui reçoit un snapshot complet des crédits.

    L'ordi librairie pousse périodiquement l'état complet (clients +
    crédits + règlements) et le cloud remplace son état par celui-ci.
    Approche idempotente : pas de gestion de conflits, pas de risque de
    désync. Le cloud est read-only pour les crédits (consultation uniquement).
    """
    import json
    import os
    from datetime import datetime

    try:
        from credit.models import Customer, CreditSale, CreditPayment
    except Exception as exc:
        logger.error("Credit app not installed on cloud: %s", exc)
        return Response(
            {'detail': "Application crédit non installée côté cloud."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    data = request.data
    customers = data.get('customers', [])
    credit_sales = data.get('credit_sales', [])
    credit_payments = data.get('credit_payments', [])

    # Auto-backup local : on écrit l'état précédent dans un fichier JSON
    # avant de remplacer. Permet de revenir en arrière en cas de bug.
    try:
        backup_dir = os.path.join(settings.BASE_DIR, 'credit_snapshots')
        os.makedirs(backup_dir, exist_ok=True)
        ts = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        backup_file = os.path.join(backup_dir, f'snapshot_{ts}.json')
        previous = {
            'customers': list(Customer.objects.values()),
            'credit_sales': list(CreditSale.objects.values()),
            'credit_payments': list(CreditPayment.objects.values()),
        }
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(previous, f, ensure_ascii=False, indent=2, default=str)
    except Exception:
        logger.exception("Could not write pre-snapshot backup")

    try:
        with transaction.atomic():
            # On supprime tout puis on recrée — ordre important pour respecter
            # les FK (payments → credit_sales → customers + sales).
            CreditPayment.objects.all().delete()
            CreditSale.objects.all().delete()
            Customer.objects.all().delete()

            # 1. Customers (pas de FK externe)
            customer_by_local_id = {}
            for c in customers:
                obj = Customer.objects.create(
                    name=c['name'],
                    phone=c.get('phone', ''),
                    note=c.get('note', ''),
                )
                # Override created_at si fourni
                if c.get('created_at'):
                    Customer.objects.filter(id=obj.id).update(created_at=c['created_at'])
                customer_by_local_id[c['local_id']] = obj.id

            # 2. CreditSales (FK vers Customer local et Sale cloud)
            credit_sale_by_local_id = {}
            skipped_credit_sales = 0
            for cs in credit_sales:
                customer_id = customer_by_local_id.get(cs['customer_local_id'])
                if not customer_id:
                    skipped_credit_sales += 1
                    continue
                # On retrouve la Sale par local_sync_id (déjà importée par
                # le sync principal des ventes)
                sale = Sale.objects.filter(
                    local_sync_id=str(cs['sale_local_id'])
                ).first()
                if not sale:
                    skipped_credit_sales += 1
                    continue
                # Une Sale ne peut avoir qu'un seul CreditSale (OneToOne)
                if CreditSale.objects.filter(sale=sale).exists():
                    skipped_credit_sales += 1
                    continue
                obj = CreditSale.objects.create(
                    sale=sale,
                    customer_id=customer_id,
                    status=cs.get('status', 'UNPAID'),
                    paid_amount=cs.get('paid_amount', 0),
                )
                if cs.get('created_at'):
                    CreditSale.objects.filter(id=obj.id).update(created_at=cs['created_at'])
                credit_sale_by_local_id[cs['local_id']] = obj.id

            # 3. CreditPayments
            from core.models import User
            skipped_payments = 0
            for p in credit_payments:
                cs_id = credit_sale_by_local_id.get(p['credit_sale_local_id'])
                if not cs_id:
                    skipped_payments += 1
                    continue
                user = None
                if p.get('created_by_username'):
                    user = User.objects.filter(
                        username=p['created_by_username']
                    ).first()
                obj = CreditPayment.objects.create(
                    credit_sale_id=cs_id,
                    amount=p['amount'],
                    note=p.get('note', ''),
                    created_by=user,
                )
                if p.get('created_at'):
                    CreditPayment.objects.filter(id=obj.id).update(
                        created_at=p['created_at']
                    )

        return Response({
            'status': 'success',
            'customers_imported': len(customers),
            'credit_sales_imported': len(credit_sales) - skipped_credit_sales,
            'credit_sales_skipped': skipped_credit_sales,
            'credit_payments_imported': len(credit_payments) - skipped_payments,
            'credit_payments_skipped': skipped_payments,
            'received_at': timezone.now().isoformat(),
        })
    except Exception as exc:
        logger.exception("Credits snapshot import failed")
        return Response(
            {'detail': f'Snapshot crédit échoué: {exc}'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def trigger_sync(request):
    """Manually trigger a sync (admin only)."""
    if not request.user.role == 'ADMIN':
        return Response({'error': 'Admin only'}, status=status.HTTP_403_FORBIDDEN)
    
    from core.sync_service import sync_service
    result = sync_service.full_sync()
    
    return Response(result)
