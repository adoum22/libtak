#!/usr/bin/env python
"""
Sync Service - Pushes local data to cloud server
Run this script every 30 minutes via Windows Task Scheduler

Usage:
    python sync_service.py

Environment Variables:
    CLOUD_API_URL - URL of the cloud API (default: Railway URL)
    SYNC_API_KEY - Secret key for sync authentication
"""
import os
import sys
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

# Setup Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

import requests
from django.utils import timezone
from sales.models import Sale, SaleItem
from inventory.models import Product

# Configuration
CLOUD_API_URL = os.environ.get('CLOUD_API_URL', 'https://libtak-production.up.railway.app/api')
SYNC_API_KEY = os.environ.get('SYNC_API_KEY', 'libtak_sync_secret_2024')
SYNC_STATE_FILE = BASE_DIR / 'sync_state.json'
SYNC_INTERVAL_MINUTES = 30

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(BASE_DIR / 'sync.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def load_sync_state():
    """Load last sync timestamp from file."""
    if SYNC_STATE_FILE.exists():
        try:
            with open(SYNC_STATE_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {'last_sync': None, 'last_sale_id': 0}


def save_sync_state(state):
    """Save sync state to file."""
    with open(SYNC_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2, default=str)


def get_sales_to_sync(last_sync_time):
    """Get all sales created since last sync."""
    queryset = Sale.objects.all()
    
    if last_sync_time:
        try:
            last_dt = datetime.fromisoformat(last_sync_time.replace('Z', '+00:00'))
            queryset = queryset.filter(created_at__gt=last_dt)
        except:
            pass
    
    sales_data = []
    for sale in queryset.order_by('created_at'):
        items_data = []
        for item in sale.items.all():
            items_data.append({
                'product_id': item.product_id,
                'product_name': item.product_name,
                'quantity': item.quantity,
                'unit_price_ht': str(item.unit_price_ht),
                'total_price_ht': str(item.total_price_ht),
                'tva_rate': str(item.tva_rate)
            })
        
        sales_data.append({
            'local_id': sale.id,
            'user_id': sale.user_id,
            'total_ht': str(sale.total_ht),
            'total_tva': str(sale.total_tva),
            'total_ttc': str(sale.total_ttc),
            'payment_method': sale.payment_method,
            'created_at': sale.created_at.isoformat(),
            'items': items_data
        })
    
    return sales_data


def get_products_to_sync(last_sync_time):
    """Get all products updated since last sync."""
    queryset = Product.objects.all()
    
    if last_sync_time:
        try:
            last_dt = datetime.fromisoformat(last_sync_time.replace('Z', '+00:00'))
            queryset = queryset.filter(updated_at__gt=last_dt)
        except:
            pass
    
    products_data = []
    for product in queryset:
        products_data.append({
            'id': product.id,
            'barcode': product.barcode,
            'stock': product.stock,
            'sale_price_ht': str(product.sale_price_ht),
            'purchase_price': str(product.purchase_price),
            'updated_at': product.updated_at.isoformat() if product.updated_at else None
        })
    
    return products_data


def check_cloud_connectivity():
    """Check if cloud server is reachable."""
    try:
        response = requests.get(
            f"{CLOUD_API_URL}/auth/sync/status/",
            timeout=10
        )
        return response.status_code == 200
    except:
        return False


def push_to_cloud(sales_data, products_data):
    """Push data to cloud server."""
    payload = {
        'api_key': SYNC_API_KEY,
        'sales': sales_data,
        'products': products_data,
        'local_timestamp': timezone.now().isoformat()
    }
    
    response = requests.post(
        f"{CLOUD_API_URL}/auth/sync/push/",
        json=payload,
        timeout=60
    )
    
    return response


def run_sync():
    """Main sync function."""
    logger.info("=" * 50)
    logger.info("Starting sync process...")
    
    # Load state
    state = load_sync_state()
    last_sync = state.get('last_sync')
    
    if last_sync:
        logger.info(f"Last sync: {last_sync}")
    else:
        logger.info("First sync - will sync all data")
    
    # Check connectivity
    if not check_cloud_connectivity():
        logger.warning("Cloud server not reachable. Sync postponed.")
        return False
    
    logger.info("Cloud server is online")
    
    # Get data to sync
    sales_data = get_sales_to_sync(last_sync)
    products_data = get_products_to_sync(last_sync)
    
    logger.info(f"Sales to sync: {len(sales_data)}")
    logger.info(f"Products to sync: {len(products_data)}")
    
    if not sales_data and not products_data:
        logger.info("Nothing to sync - all data is up to date")
        state['last_sync'] = timezone.now().isoformat()
        save_sync_state(state)
        return True
    
    # Push to cloud
    try:
        response = push_to_cloud(sales_data, products_data)
        
        if response.status_code == 200:
            result = response.json()
            logger.info(f"Sync successful!")
            logger.info(f"  Sales created: {result.get('results', {}).get('sales_created', 0)}")
            logger.info(f"  Sales skipped: {result.get('results', {}).get('sales_skipped', 0)}")
            logger.info(f"  Products updated: {result.get('results', {}).get('products_updated', 0)}")
            
            # Update state
            state['last_sync'] = timezone.now().isoformat()
            save_sync_state(state)
            return True
        else:
            logger.error(f"Sync failed with status {response.status_code}")
            logger.error(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error during sync: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error during sync: {e}")
        return False


if __name__ == '__main__':
    try:
        success = run_sync()
        sys.exit(0 if success else 1)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
