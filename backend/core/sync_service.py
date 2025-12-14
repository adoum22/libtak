"""
Synchronization Service for Local-to-Cloud data sync.
This service handles syncing sales, products, and inventory between
the local store server and the cloud server.
"""
import json
import logging
from datetime import datetime, timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
import requests

from sales.models import Sale, SaleItem, Return, ReturnItem
from inventory.models import Product, Category, Supplier
from core.models import User, AppSettings

logger = logging.getLogger(__name__)


class SyncService:
    """
    Handles synchronization between local and cloud servers.
    
    Sync Strategy:
    - Local → Cloud: Push new sales, returns, and stock updates
    - Cloud → Local: Pull new products, categories, suppliers (master data)
    """
    
    def __init__(self):
        self.cloud_url = settings.CLOUD_API_URL if hasattr(settings, 'CLOUD_API_URL') else None
        self.sync_token = settings.SYNC_TOKEN if hasattr(settings, 'SYNC_TOKEN') else None
        self.last_sync_file = settings.BASE_DIR / '.last_sync'
    
    def get_last_sync_time(self) -> datetime:
        """Get the timestamp of the last successful sync."""
        try:
            if self.last_sync_file.exists():
                timestamp = self.last_sync_file.read_text().strip()
                return datetime.fromisoformat(timestamp)
        except Exception as e:
            logger.warning(f"Could not read last sync time: {e}")
        return datetime.now() - timedelta(days=365)  # Default: sync everything
    
    def set_last_sync_time(self, timestamp: datetime = None):
        """Update the last sync timestamp."""
        if timestamp is None:
            timestamp = timezone.now()
        try:
            self.last_sync_file.write_text(timestamp.isoformat())
        except Exception as e:
            logger.error(f"Could not save last sync time: {e}")
    
    def get_pending_sales(self) -> list:
        """Get sales created since last sync."""
        last_sync = self.get_last_sync_time()
        sales = Sale.objects.filter(
            created_at__gt=last_sync,
            synced=False
        ).select_related('user').prefetch_related('items__product')
        
        return [self._serialize_sale(sale) for sale in sales]
    
    def _serialize_sale(self, sale: Sale) -> dict:
        """Serialize a sale for sync."""
        return {
            'local_id': sale.id,
            'total_ht': str(sale.total_ht),
            'total_ttc': str(sale.total_ttc),
            'payment_method': sale.payment_method,
            'created_at': sale.created_at.isoformat(),
            'user_username': sale.user.username if sale.user else None,
            'items': [
                {
                    'product_barcode': item.product.barcode,
                    'product_name': item.product.name,
                    'quantity': item.quantity,
                    'unit_price_ht': str(item.unit_price_ht),
                    'unit_price_ttc': str(item.unit_price_ttc),
                    'total_ht': str(item.total_ht),
                    'total_ttc': str(item.total_ttc),
                }
                for item in sale.items.all()
            ]
        }
    
    def get_pending_returns(self) -> list:
        """Get returns created since last sync."""
        last_sync = self.get_last_sync_time()
        returns = Return.objects.filter(
            created_at__gt=last_sync,
            synced=False
        ).prefetch_related('items__sale_item__product')
        
        return [self._serialize_return(ret) for ret in returns]
    
    def _serialize_return(self, ret: Return) -> dict:
        """Serialize a return for sync."""
        return {
            'local_id': ret.id,
            'sale_local_id': ret.sale_id,
            'reason': ret.reason,
            'total_refund': str(ret.total_refund),
            'status': ret.status,
            'created_at': ret.created_at.isoformat(),
            'items': [
                {
                    'product_barcode': item.sale_item.product.barcode,
                    'quantity': item.quantity,
                    'refund_amount': str(item.refund_amount),
                }
                for item in ret.items.all()
            ]
        }
    
    def get_stock_updates(self) -> list:
        """Get products with stock changes since last sync."""
        last_sync = self.get_last_sync_time()
        products = Product.objects.filter(
            updated_at__gt=last_sync
        ).values('barcode', 'stock', 'name')
        
        return list(products)
    
    def push_to_cloud(self) -> dict:
        """Push local data to cloud server."""
        if not self.cloud_url or not self.sync_token:
            return {'status': 'error', 'message': 'Cloud sync not configured'}
        
        data = {
            'sales': self.get_pending_sales(),
            'returns': self.get_pending_returns(),
            'stock_updates': self.get_stock_updates(),
            'sync_timestamp': timezone.now().isoformat(),
        }
        
        try:
            response = requests.post(
                f"{self.cloud_url}/sync/receive/",
                json=data,
                headers={
                    'Authorization': f'SyncToken {self.sync_token}',
                    'Content-Type': 'application/json'
                },
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                # Mark synced items
                self._mark_sales_synced(data['sales'])
                self._mark_returns_synced(data['returns'])
                self.set_last_sync_time()
                
                return {
                    'status': 'success',
                    'synced_sales': len(data['sales']),
                    'synced_returns': len(data['returns']),
                    'synced_stock_updates': len(data['stock_updates']),
                }
            else:
                return {
                    'status': 'error',
                    'message': f"Cloud returned {response.status_code}",
                    'details': response.text[:500]
                }
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Sync push failed: {e}")
            return {'status': 'error', 'message': str(e)}
    
    def _mark_sales_synced(self, sales_data: list):
        """Mark sales as synced after successful push."""
        local_ids = [s['local_id'] for s in sales_data]
        Sale.objects.filter(id__in=local_ids).update(synced=True)
    
    def _mark_returns_synced(self, returns_data: list):
        """Mark returns as synced after successful push."""
        local_ids = [r['local_id'] for r in returns_data]
        Return.objects.filter(id__in=local_ids).update(synced=True)
    
    def pull_from_cloud(self) -> dict:
        """Pull master data (products, categories, suppliers) from cloud."""
        if not self.cloud_url or not self.sync_token:
            return {'status': 'error', 'message': 'Cloud sync not configured'}
        
        try:
            response = requests.get(
                f"{self.cloud_url}/sync/master-data/",
                headers={
                    'Authorization': f'SyncToken {self.sync_token}',
                },
                params={'since': self.get_last_sync_time().isoformat()},
                timeout=30
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Process incoming master data
                categories_count = self._import_categories(data.get('categories', []))
                suppliers_count = self._import_suppliers(data.get('suppliers', []))
                products_count = self._import_products(data.get('products', []))
                
                return {
                    'status': 'success',
                    'imported_categories': categories_count,
                    'imported_suppliers': suppliers_count,
                    'imported_products': products_count,
                }
            else:
                return {
                    'status': 'error',
                    'message': f"Cloud returned {response.status_code}"
                }
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Sync pull failed: {e}")
            return {'status': 'error', 'message': str(e)}
    
    @transaction.atomic
    def _import_categories(self, categories: list) -> int:
        """Import or update categories from cloud."""
        count = 0
        for cat_data in categories:
            _, created = Category.objects.update_or_create(
                name=cat_data['name'],
                defaults={'description': cat_data.get('description', '')}
            )
            if created:
                count += 1
        return count
    
    @transaction.atomic
    def _import_suppliers(self, suppliers: list) -> int:
        """Import or update suppliers from cloud."""
        count = 0
        for sup_data in suppliers:
            _, created = Supplier.objects.update_or_create(
                name=sup_data['name'],
                defaults={
                    'email': sup_data.get('email', ''),
                    'phone': sup_data.get('phone', ''),
                    'address': sup_data.get('address', ''),
                }
            )
            if created:
                count += 1
        return count
    
    @transaction.atomic
    def _import_products(self, products: list) -> int:
        """Import or update products from cloud (does NOT overwrite stock)."""
        count = 0
        for prod_data in products:
            existing = Product.objects.filter(barcode=prod_data['barcode']).first()
            
            if existing:
                # Update everything except stock (stock is local authority)
                existing.name = prod_data['name']
                existing.purchase_price_ht = prod_data.get('purchase_price_ht', existing.purchase_price_ht)
                existing.sale_price_ht = prod_data.get('sale_price_ht', existing.sale_price_ht)
                existing.tva_rate = prod_data.get('tva_rate', existing.tva_rate)
                existing.min_stock = prod_data.get('min_stock', existing.min_stock)
                existing.save()
            else:
                # New product from cloud
                category = None
                if prod_data.get('category_name'):
                    category, _ = Category.objects.get_or_create(name=prod_data['category_name'])
                
                Product.objects.create(
                    barcode=prod_data['barcode'],
                    name=prod_data['name'],
                    category=category,
                    purchase_price_ht=prod_data.get('purchase_price_ht', 0),
                    sale_price_ht=prod_data.get('sale_price_ht', 0),
                    tva_rate=prod_data.get('tva_rate', 20),
                    stock=prod_data.get('stock', 0),
                    min_stock=prod_data.get('min_stock', 5),
                )
                count += 1
        return count
    
    def full_sync(self) -> dict:
        """Perform full bidirectional sync."""
        push_result = self.push_to_cloud()
        pull_result = self.pull_from_cloud()
        
        return {
            'push': push_result,
            'pull': pull_result,
            'timestamp': timezone.now().isoformat()
        }


# Singleton instance
sync_service = SyncService()
