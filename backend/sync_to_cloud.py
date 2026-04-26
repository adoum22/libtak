#!/usr/bin/env python
"""
Script de synchronisation LOCAL → CLOUD
Ce script envoie les ventes et retours locaux vers le serveur cloud (PythonAnywhere).
Il est conçu pour être exécuté toutes les 30 minutes via le Planificateur de tâches Windows.

Usage: python sync_to_cloud.py
"""

import os
import sys
import json
import requests
from datetime import datetime, timedelta

# Configuration Django
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.utils import timezone
from django.conf import settings
from sales.models import Sale, SaleItem, Return, ReturnItem
from inventory.models import Product
from core.models import SyncLog

# Configuration
CLOUD_URL = "https://dido22.pythonanywhere.com/api/auth"
SYNC_TOKEN = os.environ.get('SYNC_TOKEN', 'libtak-sync-token-2025')


def get_unsynced_sales():
    """Récupère les ventes non synchronisées."""
    return Sale.objects.filter(synced=False).select_related('user').prefetch_related('items__product')


def get_unsynced_returns():
    """Récupère les retours non synchronisés."""
    return Return.objects.filter(synced=False).select_related('sale', 'processed_by').prefetch_related('items__sale_item')


def serialize_sale(sale):
    """Sérialise une vente pour l'envoi."""
    items = []
    for item in sale.items.all():
        items.append({
            'product_barcode': item.product.barcode if item.product else None,
            'product_name': item.product.name if item.product else item.product_name,
            'quantity': item.quantity,
            'unit_price': str(item.unit_price_ht),
            'unit_price_ht': str(item.unit_price_ht),
            'total_ht': str(item.total_price_ht),
            'tva_rate': str(item.tva_rate),
            'unit_purchase_price': str(item.unit_purchase_price),
            'total_purchase_cost': str(item.total_purchase_cost),
        })
    
    return {
        'id': sale.id,
        'created_at': sale.created_at.isoformat(),
        'user_username': sale.user.username if sale.user else None,
        'payment_method': sale.payment_method,
        'total_ht': str(sale.total_ht),
        'total_tva': str(sale.total_tva),
        'total_ttc': str(sale.total_ttc),
        'discount_amount': str(sale.discount_amount),
        'items': items,
    }


def serialize_return(return_obj):
    """Sérialise un retour pour l'envoi."""
    items = []
    for item in return_obj.items.all():
        # ReturnItem a sale_item, pas product directement
        product_barcode = None
        if item.sale_item and item.sale_item.product:
            product_barcode = item.sale_item.product.barcode
        items.append({
            'product_barcode': product_barcode,
            'quantity': item.quantity,
            'refund_amount': str(item.sale_item.unit_price_ht * item.quantity) if item.sale_item else '0',
        })
    
    return {
        'id': return_obj.id,
        'sale_id': return_obj.sale_id,
        'created_at': return_obj.created_at.isoformat(),
        'reason': return_obj.reason,
        'refund_amount': str(return_obj.refund_amount),
        'status': return_obj.status,
        'processed_by_username': return_obj.processed_by.username if return_obj.processed_by else None,
        'items': items,
    }


def get_stock_data():
    """Récupère les données de stock actuelles."""
    products = Product.objects.all()
    return [
        {
            'barcode': p.barcode,
            'stock': p.stock,
        }
        for p in products
    ]


def sync_to_cloud():
    """Effectue la synchronisation vers le cloud."""
    print(f"\n{'='*60}")
    print(f"🔄 SYNCHRONISATION LOCAL → CLOUD")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    # Récupérer les données non synchronisées
    sales = get_unsynced_sales()
    returns = get_unsynced_returns()
    
    print(f"📊 Ventes à synchroniser: {sales.count()}")
    print(f"📊 Retours à synchroniser: {returns.count()}")
    
    if sales.count() == 0 and returns.count() == 0:
        print("\n✅ Rien à synchroniser, tout est à jour!")
        return True
    
    # Préparer les données
    payload = {
        'sales': [serialize_sale(s) for s in sales],
        'returns': [serialize_return(r) for r in returns],
        'stock_data': get_stock_data(),
        'sync_timestamp': timezone.now().isoformat(),
    }
    
    # Envoyer au cloud
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'SyncToken {SYNC_TOKEN}',
    }
    
    try:
        print(f"\n📤 Envoi vers {CLOUD_URL}/sync/receive/...")
        response = requests.post(
            f"{CLOUD_URL}/sync/receive/",
            json=payload,
            headers=headers,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            
            # Marquer comme synchronisé
            sales_synced = sales.update(synced=True)
            returns_synced = returns.update(synced=True)
            
            # Log de synchronisation
            SyncLog.objects.create(
                sync_type='PUSH',
                records_synced=sales_synced + returns_synced,
                success=True,
                details=json.dumps({
                    'sales_synced': sales_synced,
                    'returns_synced': returns_synced,
                })
            )
            
            print(f"\n✅ Synchronisation réussie!")
            print(f"   - Ventes synchronisées: {sales_synced}")
            print(f"   - Retours synchronisés: {returns_synced}")
            return True
            
        else:
            error_msg = f"Erreur HTTP {response.status_code}: {response.text}"
            print(f"\n❌ {error_msg}")
            
            SyncLog.objects.create(
                sync_type='PUSH',
                records_synced=0,
                success=False,
                error_message=error_msg
            )
            return False
            
    except requests.exceptions.ConnectionError:
        error_msg = "Impossible de se connecter au serveur cloud. Vérifiez votre connexion internet."
        print(f"\n❌ {error_msg}")
        
        SyncLog.objects.create(
            sync_type='PUSH',
            records_synced=0,
            success=False,
            error_message=error_msg
        )
        return False
        
    except Exception as e:
        error_msg = f"Erreur: {str(e)}"
        print(f"\n❌ {error_msg}")
        
        SyncLog.objects.create(
            sync_type='PUSH',
            records_synced=0,
            success=False,
            error_message=error_msg
        )
        return False


def pull_master_data():
    """Récupère les données maîtres depuis le cloud (produits, catégories, etc.)."""
    print(f"\n📥 Récupération des données maîtres depuis le cloud...")
    
    headers = {
        'X-Sync-Token': SYNC_TOKEN,
    }
    
    try:
        response = requests.get(
            f"{CLOUD_URL}/sync/master-data/",
            headers=headers,
            timeout=60
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Mettre à jour les produits locaux
            products_updated = 0
            for prod_data in data.get('products', []):
                Product.objects.update_or_create(
                    barcode=prod_data['barcode'],
                    defaults={
                        'name': prod_data['name'],
                        'purchase_price': prod_data['purchase_price'],
                        'selling_price': prod_data['selling_price'],
                        'stock': prod_data.get('stock', 0),
                        'min_stock': prod_data.get('min_stock', 5),
                    }
                )
                products_updated += 1
            
            print(f"✅ {products_updated} produits mis à jour depuis le cloud")
            return True
        else:
            print(f"❌ Erreur lors de la récupération: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Erreur: {str(e)}")
        return False


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Synchronisation LibTak')
    parser.add_argument('--pull', action='store_true', help='Récupérer les données maîtres depuis le cloud')
    parser.add_argument('--push', action='store_true', help='Envoyer les ventes vers le cloud')
    args = parser.parse_args()
    
    if args.pull:
        pull_master_data()
    elif args.push:
        sync_to_cloud()
    else:
        # Par défaut: push (envoi des ventes)
        sync_to_cloud()
    
    print(f"\n{'='*60}\n")
