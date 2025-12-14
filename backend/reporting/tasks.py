from celery import shared_task
from django.core.mail import send_mail, get_connection
from django.template.loader import render_to_string
from django.utils import timezone
from django.db.models import Sum, F, Count
from django.conf import settings
from datetime import timedelta
from decimal import Decimal

from sales.models import Sale, SaleItem
from .models import ReportSettings, ReportLog


def get_report_data(start_date, end_date):
    """Calcule les données du rapport pour une période"""
    from sales.models import Return, ReturnItem
    
    # Ventes de la période
    sales = Sale.objects.filter(
        created_at__date__gte=start_date,
        created_at__date__lte=end_date
    )
    
    # Totaux
    total_sales = sales.count()
    
    # Articles vendus groupés - utiliser le prix HT (sans TVA)
    items = SaleItem.objects.filter(
        sale__in=sales
    ).values(
        'product__name', 'product__barcode'
    ).annotate(
        total_qty=Sum('quantity'),
        total_revenue=Sum(F('unit_price_ht') * F('quantity')),
        total_cost=Sum(F('quantity') * F('product__purchase_price')),
        avg_unit_price=Sum(F('unit_price_ht') * F('quantity')) / Sum('quantity')
    ).order_by('-total_qty')
    
    # Calcul du bénéfice
    items_sold = []
    total_revenue = Decimal('0')
    total_profit = Decimal('0')
    
    for item in items:
        cost = item['total_cost'] or Decimal('0')
        revenue = item['total_revenue'] or Decimal('0')
        profit = revenue - cost
        unit_price = item['avg_unit_price'] or Decimal('0')
        
        total_revenue += revenue
        total_profit += profit
        
        items_sold.append({
            'name': item['product__name'],
            'barcode': item['product__barcode'],
            'quantity': item['total_qty'],
            'unit_price': float(unit_price),
            'revenue': float(revenue),
            'cost': float(cost),
            'profit': float(profit)
        })
    
    # Calcul des retours COMPLÉTÉS de la période
    completed_returns = Return.objects.filter(
        status='COMPLETED',
        created_at__date__gte=start_date,
        created_at__date__lte=end_date
    )
    
    total_returns = Decimal('0')
    returns_count = completed_returns.count()
    
    for ret in completed_returns:
        total_returns += ret.refund_amount or Decimal('0')
    
    # Soustraire les retours du CA et du bénéfice
    net_revenue = float(total_revenue) - float(total_returns)
    net_profit = float(total_profit) - float(total_returns)
    
    # Données pour le graphique
    from django.db.models.functions import TruncHour, TruncDay
    
    chart_data = []
    
    if start_date == end_date:
        # Vue journalière : par heure
        hourly_sales = sales.annotate(
            hour=TruncHour('created_at')
        ).values('hour').annotate(
            revenue=Sum('total_ttc'),
            count=Count('id')
        ).order_by('hour')
        
        # Remplir les trous d'heures (8h à minuit)
        sales_by_hour = {item['hour'].hour: item for item in hourly_sales}
        for hour in range(8, 24): # De 8h à 23h
            data_point = sales_by_hour.get(hour, {'revenue': 0, 'count': 0})
            chart_data.append({
                'label': f"{hour}h",
                'revenue': float(data_point['revenue'] or 0),
                'count': data_point['count'] or 0
            })
        # Ajouter minuit (00h)
        data_point = sales_by_hour.get(0, {'revenue': 0, 'count': 0})
        chart_data.append({
            'label': "00h",
            'revenue': float(data_point['revenue'] or 0),
            'count': data_point['count'] or 0
        })
            
    else:
        # Vue période : par jour
        daily_sales = sales.annotate(
            day=TruncDay('created_at')
        ).values('day').annotate(
            revenue=Sum('total_ttc'),
            count=Count('id')
        ).order_by('day')
        
        # Convertir en liste
        for item in daily_sales:
            chart_data.append({
                'label': item['day'].strftime('%d/%m'),
                'revenue': float(item['revenue'] or 0),
                'count': item['count']
            })

    result = {
        'total_sales': total_sales,
        'total_revenue': net_revenue,  # CA net (après retours)
        'total_profit': net_profit,     # Bénéfice net (après retours)
        'items_sold': items_sold,
        'chart_data': chart_data
    }
    
    # Ajouter les retours seulement s'il y en a
    if returns_count > 0:
        result['returns_count'] = returns_count
        result['total_returns'] = float(total_returns)
        result['gross_revenue'] = float(total_revenue)  # CA brut (avant retours)
    
    return result



def send_report_email(report_type, start_date, end_date, data, recipients):
    """Envoie le rapport par email avec configuration SMTP dynamique"""
    
    settings_obj = ReportSettings.get_settings()
    
    subject_map = {
        'DAILY': f'Rapport Journalier - {end_date.strftime("%d/%m/%Y")}',
        'WEEKLY': f'Rapport Hebdomadaire - Semaine du {start_date.strftime("%d/%m/%Y")}',
        'MONTHLY': f'Rapport Mensuel - {start_date.strftime("%B %Y")}',
        'QUARTERLY': f'Rapport Trimestriel - Q{(start_date.month-1)//3+1} {start_date.year}',
        'YEARLY': f'Rapport Annuel - {start_date.year}'
    }
    
    subject = f"[{settings.store_name if hasattr(settings, 'store_name') else 'Librairie'}] {subject_map.get(report_type, 'Rapport')}"
    
    # Construction du message HTML
    html_message = f"""
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; }}
            .header {{ background: #1e40af; color: white; padding: 20px; }}
            .content {{ padding: 20px; }}
            .stat {{ background: #f3f4f6; padding: 15px; margin: 10px 0; border-radius: 8px; }}
            .stat-value {{ font-size: 24px; font-weight: bold; color: #1e40af; }}
            table {{ width: 100%; border-collapse: collapse; margin: 20px 0; }}
            th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }}
            th {{ background: #f9fafb; }}
            .profit {{ color: #16a34a; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📚 Librairie Attaquaddoum</h1>
            <h2>{subject_map.get(report_type, 'Rapport')}</h2>
        </div>
        <div class="content">
            <p>Période: <strong>{start_date.strftime("%d/%m/%Y")} - {end_date.strftime("%d/%m/%Y")}</strong></p>
            
            <div class="stat">
                <div>Nombre de ventes</div>
                <div class="stat-value">{data['total_sales']}</div>
            </div>
            
            <div class="stat">
                <div>Chiffre d'affaires</div>
                <div class="stat-value">{data['total_revenue']:.2f} DH</div>
            </div>
            
            <div class="stat">
                <div>Bénéfice</div>
                <div class="stat-value profit">{data['total_profit']:.2f} DH</div>
            </div>
            
            <h3>📦 Articles vendus</h3>
            <table>
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th style="text-align: right;">Prix Unit.</th>
                        <th style="text-align: center;">Qté</th>
                        <th style="text-align: right;">Total</th>
                        <th style="text-align: right;">Marge</th>
                    </tr>
                </thead>
                <tbody>
    """
    
    for item in data['items_sold'][:20]:  # Top 20
        html_message += f"""
                    <tr>
                        <td>{item['name']}</td>
                        <td style="text-align: right;">{item['unit_price']:.2f} DH</td>
                        <td style="text-align: center;">{item['quantity']}</td>
                        <td style="text-align: right;">{item['revenue']:.2f} DH</td>
                        <td style="text-align: right;" class="profit">{item['profit']:.2f} DH</td>
                    </tr>
        """
    
    html_message += """
                </tbody>
            </table>
            
            <p style="color: #6b7280; font-size: 12px;">
                Ce rapport a été généré automatiquement. 
                Pour modifier les paramètres, connectez-vous à l'application.
            </p>
        </div>
    </body>
    </html>
    """
    
    # Envoi avec SMTP dynamique
    try:
        connection = None
        from_email = settings.DEFAULT_FROM_EMAIL

        # Si configuration SMTP personnalisée
        if settings_obj.sender_email and settings_obj.sender_password:
            connection = get_connection(
                host=settings_obj.smtp_host,
                port=settings_obj.smtp_port,
                username=settings_obj.sender_email,
                password=settings_obj.sender_password,
                use_tls=True
            )
            from_email = settings_obj.sender_email
        
        send_mail(
            subject=subject,
            message=f"Rapport {report_type} - CA: {data['total_revenue']:.2f} DH, Bénéfice: {data['total_profit']:.2f} DH",
            from_email=from_email,
            recipient_list=recipients,
            html_message=html_message,
            fail_silently=False,
            connection=connection
        )
        return True, ""
    except Exception as e:
        return False, str(e)


@shared_task
def send_daily_report():
    """Rapport journalier - tous les jours à 23h"""
    report_settings = ReportSettings.get_settings()
    
    if not report_settings.daily_enabled:
        return "Daily report disabled"
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    today = timezone.now().date()
    data = get_report_data(today, today)
    
    success, error = send_report_email('DAILY', today, today, data, recipients)
    
    # Log
    ReportLog.objects.create(
        report_type='DAILY',
        period_start=today,
        period_end=today,
        total_sales=data['total_sales'],
        total_revenue=data['total_revenue'],
        total_profit=data['total_profit'],
        items_sold=data['items_sold'],
        recipients=','.join(recipients),
        success=success,
        error_message=error
    )
    
    return f"Daily report sent: {success}"


@shared_task
def send_weekly_report():
    """Rapport hebdomadaire - tous les dimanches à 23h30"""
    report_settings = ReportSettings.get_settings()
    
    if not report_settings.weekly_enabled:
        return "Weekly report disabled"
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    today = timezone.now().date()
    start_date = today - timedelta(days=6)
    
    data = get_report_data(start_date, today)
    
    success, error = send_report_email('WEEKLY', start_date, today, data, recipients)
    
    ReportLog.objects.create(
        report_type='WEEKLY',
        period_start=start_date,
        period_end=today,
        total_sales=data['total_sales'],
        total_revenue=data['total_revenue'],
        total_profit=data['total_profit'],
        items_sold=data['items_sold'],
        recipients=','.join(recipients),
        success=success,
        error_message=error
    )
    
    return f"Weekly report sent: {success}"


@shared_task
def send_monthly_report():
    """Rapport mensuel - dernier jour du mois à 23h45"""
    report_settings = ReportSettings.get_settings()
    
    if not report_settings.monthly_enabled:
        return "Monthly report disabled"
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    today = timezone.now().date()
    start_date = today.replace(day=1)
    
    data = get_report_data(start_date, today)
    
    success, error = send_report_email('MONTHLY', start_date, today, data, recipients)
    
    ReportLog.objects.create(
        report_type='MONTHLY',
        period_start=start_date,
        period_end=today,
        total_sales=data['total_sales'],
        total_revenue=data['total_revenue'],
        total_profit=data['total_profit'],
        items_sold=data['items_sold'],
        recipients=','.join(recipients),
        success=success,
        error_message=error
    )
    
    return f"Monthly report sent: {success}"


@shared_task
def send_quarterly_report():
    """Rapport trimestriel - dernier jour du trimestre à 23h50"""
    report_settings = ReportSettings.get_settings()
    
    if not report_settings.quarterly_enabled:
        return "Quarterly report disabled"
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    today = timezone.now().date()
    quarter = (today.month - 1) // 3
    start_month = quarter * 3 + 1
    start_date = today.replace(month=start_month, day=1)
    
    data = get_report_data(start_date, today)
    
    success, error = send_report_email('QUARTERLY', start_date, today, data, recipients)
    
    ReportLog.objects.create(
        report_type='QUARTERLY',
        period_start=start_date,
        period_end=today,
        total_sales=data['total_sales'],
        total_revenue=data['total_revenue'],
        total_profit=data['total_profit'],
        items_sold=data['items_sold'],
        recipients=','.join(recipients),
        success=success,
        error_message=error
    )
    
    return f"Quarterly report sent: {success}"


@shared_task
def send_yearly_report():
    """Rapport annuel - 31 décembre à 23h55"""
    report_settings = ReportSettings.get_settings()
    
    if not report_settings.yearly_enabled:
        return "Yearly report disabled"
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    today = timezone.now().date()
    start_date = today.replace(month=1, day=1)
    
    data = get_report_data(start_date, today)
    
    success, error = send_report_email('YEARLY', start_date, today, data, recipients)
    
    ReportLog.objects.create(
        report_type='YEARLY',
        period_start=start_date,
        period_end=today,
        total_sales=data['total_sales'],
        total_revenue=data['total_revenue'],
        total_profit=data['total_profit'],
        items_sold=data['items_sold'],
        recipients=','.join(recipients),
        success=success,
        error_message=error
    )
    
    return f"Yearly report sent: {success}"


@shared_task
def send_low_stock_alert():
    """Alerte stock bas - tous les jours à 9h"""
    from inventory.models import Product
    
    report_settings = ReportSettings.get_settings()
    
    recipients = report_settings.get_recipients_list()
    if not recipients:
        return "No recipients configured"
    
    # Trouver les produits en stock bas
    low_stock_products = Product.objects.filter(
        stock__lte=models.F('min_stock'),
        active=True
    ).order_by('stock')
    
    if not low_stock_products.exists():
        return "No low stock products"
    
    # Construire le message HTML
    html_message = """
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; }
            .header { background: #dc2626; color: white; padding: 20px; }
            .content { padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #fef2f2; color: #dc2626; }
            .critical { background: #fee2e2; color: #dc2626; font-weight: bold; }
            .warning { background: #fef3c7; color: #d97706; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>⚠️ Alerte Stock Bas</h1>
            <p>Librairie Attaquaddoum</p>
        </div>
        <div class="content">
            <p>Les produits suivants nécessitent un réapprovisionnement :</p>
            
            <table>
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th>Code-barres</th>
                        <th>Stock Actuel</th>
                        <th>Stock Minimum</th>
                    </tr>
                </thead>
                <tbody>
    """
    
    for product in low_stock_products:
        row_class = 'critical' if product.stock == 0 else 'warning' if product.stock <= product.min_stock / 2 else ''
        html_message += f"""
                    <tr class="{row_class}">
                        <td>{product.name}</td>
                        <td>{product.barcode}</td>
                        <td>{product.stock}</td>
                        <td>{product.min_stock}</td>
                    </tr>
        """
    
    html_message += """
                </tbody>
            </table>
            
            <p style="color: #6b7280; font-size: 12px;">
                Cette alerte a été générée automatiquement.
                Connectez-vous à l'application pour gérer votre stock.
            </p>
        </div>
    </body>
    </html>
    """
    
    # Envoi
    try:
        settings_obj = ReportSettings.get_settings()
        connection = None
        from_email = settings.DEFAULT_FROM_EMAIL

        if settings_obj.sender_email and settings_obj.sender_password:
            connection = get_connection(
                host=settings_obj.smtp_host,
                port=settings_obj.smtp_port,
                username=settings_obj.sender_email,
                password=settings_obj.sender_password,
                use_tls=True
            )
            from_email = settings_obj.sender_email
        
        send_mail(
            subject=f"⚠️ [Librairie] Alerte Stock Bas - {low_stock_products.count()} produits",
            message=f"{low_stock_products.count()} produits sont en stock bas.",
            from_email=from_email,
            recipient_list=recipients,
            html_message=html_message,
            fail_silently=False,
            connection=connection
        )
        return f"Low stock alert sent for {low_stock_products.count()} products"
    except Exception as e:
        return f"Error sending low stock alert: {str(e)}"


@shared_task
def daily_database_backup():
    """
    Daily database backup task - runs at 18:00 each day.
    Saves backup with timestamp, never deletes old backups.
    """
    import os
    import json
    from django.core import serializers
    from inventory.models import Product, Category, Supplier
    from sales.models import Sale, SaleItem
    from core.models import User
    
    now = timezone.now()
    backup_dir = os.path.join(settings.BASE_DIR, 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    
    # Create timestamped backup filename
    timestamp = now.strftime('%Y-%m-%d_%H-%M-%S')
    backup_file = os.path.join(backup_dir, f'backup_{timestamp}.json')
    
    try:
        backup_data = {
            'timestamp': now.isoformat(),
            'models': {}
        }
        
        # Backup each model
        models_to_backup = [
            ('products', Product),
            ('categories', Category),
            ('suppliers', Supplier),
            ('sales', Sale),
            ('sale_items', SaleItem),
            ('users', User),
        ]
        
        for name, model in models_to_backup:
            try:
                data = serializers.serialize('json', model.objects.all())
                backup_data['models'][name] = json.loads(data)
            except Exception as e:
                backup_data['models'][name] = {'error': str(e)}
        
        # Write backup file
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, ensure_ascii=False, indent=2)
        
        # Log the backup
        ReportLog.objects.create(
            type='BACKUP',
            recipients='local',
            success=True
        )
        
        return f"Backup created: {backup_file}"
        
    except Exception as e:
        ReportLog.objects.create(
            type='BACKUP',
            recipients='local',
            success=False,
            error_message=str(e)
        )
        return f"Backup failed: {str(e)}"
