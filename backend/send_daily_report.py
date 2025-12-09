#!/usr/bin/env python
"""
Daily Email Report - Cron Job Script
This script is called by Render Cron Jobs to send daily reports.

Schedule on Render: 0 20 * * * (every day at 8 PM Morocco time / 7 PM UTC)
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
from decimal import Decimal

# Setup Django
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.conf import settings
from sales.models import Sale
from inventory.models import Product


def get_daily_stats():
    """Calculate daily statistics."""
    today = datetime.now().date()
    
    # Today's sales
    today_sales = Sale.objects.filter(created_at__date=today)
    
    total_sales = today_sales.count()
    total_revenue = sum(s.total_ttc for s in today_sales) or Decimal('0')
    total_ht = sum(s.total_ht for s in today_sales) or Decimal('0')
    
    # Estimate margin (assuming ~30% average margin)
    estimated_margin = total_ht * Decimal('0.30')
    
    # Low stock products
    low_stock = Product.objects.filter(
        active=True,
        stock__lte=5  # Products with 5 or less in stock
    ).order_by('stock')[:10]
    
    # Out of stock
    out_of_stock = Product.objects.filter(active=True, stock=0).count()
    
    return {
        'date': today.strftime('%d/%m/%Y'),
        'total_sales': total_sales,
        'total_revenue': float(total_revenue),
        'total_ht': float(total_ht),
        'estimated_margin': float(estimated_margin),
        'low_stock_products': list(low_stock.values('name', 'stock', 'barcode')),
        'out_of_stock_count': out_of_stock,
    }


def send_daily_report():
    """Send daily report email."""
    stats = get_daily_stats()
    
    # Build email content
    subject = f"📊 Rapport Librairie - {stats['date']}"
    
    # Plain text version
    message = f"""
Rapport journalier - Librairie Attaquaddoum
Date: {stats['date']}

═══════════════════════════════════════
📈 VENTES DU JOUR
═══════════════════════════════════════
• Nombre de ventes: {stats['total_sales']}
• Chiffre d'affaires TTC: {stats['total_revenue']:.2f} DH
• Chiffre d'affaires HT: {stats['total_ht']:.2f} DH
• Marge estimée: {stats['estimated_margin']:.2f} DH

═══════════════════════════════════════
⚠️ ALERTES STOCK
═══════════════════════════════════════
• Produits en rupture: {stats['out_of_stock_count']}
• Produits stock bas (≤5):
"""
    
    for p in stats['low_stock_products']:
        message += f"  - {p['name']}: {p['stock']} unités\n"
    
    if not stats['low_stock_products']:
        message += "  Aucun produit en stock bas 👍\n"
    
    message += """
═══════════════════════════════════════
Généré automatiquement par Libtak
"""
    
    # Get recipient email from settings or environment
    recipient = os.environ.get('REPORT_EMAIL', 'admin@example.com')
    
    if recipient == 'admin@example.com':
        print("⚠️ REPORT_EMAIL not configured. Set it in Render environment variables.")
        print("Email content would be:")
        print(message)
        return False
    
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            fail_silently=False,
        )
        print(f"✅ Daily report sent to {recipient}")
        return True
    except Exception as e:
        print(f"❌ Failed to send email: {e}")
        return False


if __name__ == '__main__':
    print(f"Running daily report at {datetime.now()}")
    send_daily_report()
