"""
Sync API Views - Receives data from local server and updates cloud database
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])  # Using API key authentication instead
def sync_push(request):
    """
    Receive sync data from local server.
    Expected payload:
    {
        "api_key": "secret_sync_key",
        "sales": [...],
        "products": [...],
        "local_timestamp": "2024-01-01T12:00:00Z"
    }
    """
    import os
    from sales.models import Sale, SaleItem
    from inventory.models import Product
    from core.models import User
    
    # Verify API key
    api_key = request.data.get('api_key')
    expected_key = os.environ.get('SYNC_API_KEY', 'libtak_sync_secret_2024')
    
    if api_key != expected_key:
        return Response(
            {'error': 'Invalid API key'}, 
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    sales_data = request.data.get('sales', [])
    products_data = request.data.get('products', [])
    
    results = {
        'sales_created': 0,
        'sales_updated': 0,
        'sales_skipped': 0,
        'products_updated': 0,
        'products_skipped': 0,
        'errors': []
    }
    
    try:
        with transaction.atomic():
            # Process Sales
            for sale_data in sales_data:
                try:
                    local_id = sale_data.get('local_id')
                    created_at_str = sale_data.get('created_at')
                    
                    # Check if sale already exists (by local_id in reference field or by exact timestamp)
                    existing_sale = Sale.objects.filter(
                        created_at=created_at_str
                    ).first()
                    
                    if existing_sale:
                        results['sales_skipped'] += 1
                        continue
                    
                    # Get or create user reference
                    user = None
                    if sale_data.get('user_id'):
                        user = User.objects.filter(id=sale_data['user_id']).first()
                    
                    # Create sale
                    sale = Sale.objects.create(
                        user=user,
                        total_ht=sale_data['total_ht'],
                        total_tva=sale_data['total_tva'],
                        total_ttc=sale_data['total_ttc'],
                        payment_method=sale_data.get('payment_method', 'CASH'),
                    )
                    
                    # Override created_at to match local
                    if created_at_str:
                        Sale.objects.filter(id=sale.id).update(created_at=created_at_str)
                    
                    # Create sale items
                    for item_data in sale_data.get('items', []):
                        product = None
                        if item_data.get('product_id'):
                            product = Product.objects.filter(id=item_data['product_id']).first()
                        
                        SaleItem.objects.create(
                            sale=sale,
                            product=product,
                            product_name=item_data['product_name'],
                            quantity=item_data['quantity'],
                            unit_price_ht=item_data['unit_price_ht'],
                            total_price_ht=item_data['total_price_ht'],
                            tva_rate=item_data.get('tva_rate', 20)
                        )
                    
                    results['sales_created'] += 1
                    
                except Exception as e:
                    results['errors'].append(f"Sale error: {str(e)}")
            
            # Process Products (stock updates)
            for product_data in products_data:
                try:
                    product_id = product_data.get('id')
                    local_updated = product_data.get('updated_at')
                    
                    product = Product.objects.filter(id=product_id).first()
                    
                    if not product:
                        results['products_skipped'] += 1
                        continue
                    
                    # Timestamp-based conflict resolution
                    # If local is newer, update cloud
                    if local_updated:
                        local_dt = datetime.fromisoformat(local_updated.replace('Z', '+00:00'))
                        if product.updated_at and product.updated_at >= local_dt:
                            results['products_skipped'] += 1
                            continue
                    
                    # Update stock and price if changed
                    product.stock = product_data.get('stock', product.stock)
                    product.sale_price_ht = product_data.get('sale_price_ht', product.sale_price_ht)
                    product.purchase_price = product_data.get('purchase_price', product.purchase_price)
                    product.save()
                    
                    results['products_updated'] += 1
                    
                except Exception as e:
                    results['errors'].append(f"Product error: {str(e)}")
        
        return Response({
            'success': True,
            'results': results,
            'synced_at': timezone.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Sync error: {str(e)}")
        return Response(
            {'error': str(e), 'results': results},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def sync_status(request):
    """
    Returns sync status and last sync time.
    Used by frontend to show sync indicator.
    """
    import os
    from sales.models import Sale
    from inventory.models import Product
    
    return Response({
        'status': 'online',
        'total_sales': Sale.objects.count(),
        'total_products': Product.objects.count(),
        'server_time': timezone.now().isoformat()
    })
