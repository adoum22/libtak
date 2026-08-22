import logging

from celery import shared_task
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.html import escape
from django.db import connections, transaction
from django.db.models import Sum, F, Count
from django.conf import settings
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sales.models import Sale, SaleItem
from .models import ReportSettings, ReportLog
from .backup_utils import (
    decrypt_archive,
    encryption_key_from_env,
    validate_zip_archive,
)
from .offsite_s3 import (
    remove_s3_marker,
    safe_s3_error,
    secure_backup_directory,
    sync_encrypted_backups_to_s3,
)
from core.models import AppSettings


CENT = Decimal('0.01')
logger = logging.getLogger(__name__)


def _dump_database_fixture(database_path):
    """Export one transactionally consistent server-database snapshot."""
    from django.core.management import call_command

    database_connection = connections['default']
    with transaction.atomic(using='default'):
        if database_connection.vendor == 'postgresql':
            # Django's dumpdata iterates model querysets without opening a
            # transaction. PostgreSQL READ COMMITTED could therefore mix
            # states from different instants; establish one read-only snapshot
            # before its first query.
            with database_connection.cursor() as cursor:
                cursor.execute(
                    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
                )
        with database_path.open('w', encoding='utf-8') as stream:
            call_command(
                'dumpdata',
                '--natural-foreign',
                '--natural-primary',
                '--exclude', 'contenttypes',
                '--exclude', 'auth.permission',
                '--exclude', 'sessions',
                '--exclude', 'token_blacklist',
                database='default',
                stdout=stream,
            )


@shared_task
def run_scheduled_reports():
    """Run the database-driven scheduler from Celery Beat.

    Beat must not call individual report tasks on hard-coded calendar dates;
    the management command applies the administrator's configured day/time,
    last-day-of-month rules, durable claims and retry semantics.
    """
    from django.core.management import call_command

    call_command('send_scheduled_reports')
    return 'Scheduled reports checked'


def _allocate_cents(total, weights):
    """Allocate a non-negative monetary total and preserve every cent.

    Intermediate shares use the application's ROUND_HALF_UP policy.  Any
    rounding residue is assigned to the final, deterministically ordered row,
    which makes product totals exactly reconcile with the accounting aggregate.
    """
    target = Decimal(total or 0).quantize(CENT, rounding=ROUND_HALF_UP)
    if not weights:
        return []
    normalized = [max(Decimal(weight or 0), Decimal('0')) for weight in weights]
    weight_total = sum(normalized, Decimal('0'))
    if weight_total <= 0:
        return [Decimal('0.00')] * (len(weights) - 1) + [target]

    shares = []
    allocated = Decimal('0.00')
    for weight in normalized[:-1]:
        remaining = target - allocated
        share = (target * weight / weight_total).quantize(
            CENT,
            rounding=ROUND_HALF_UP,
        )
        # Totals handled here are non-negative.  Capping prevents a sequence
        # of rounded-up shares from making the deterministic residual negative.
        share = min(max(share, Decimal('0.00')), remaining)
        shares.append(share)
        allocated += share
    shares.append(target - allocated)
    return shares


def local_datetime_bounds(start_date, end_date):
    tz = timezone.get_current_timezone()
    start_dt = timezone.make_aware(datetime.combine(start_date, time.min), tz)
    end_dt = timezone.make_aware(datetime.combine(end_date, time.max), tz)
    return start_dt, end_dt


def email_config_error():
    """Return a human-readable SMTP configuration error, or None if usable."""
    backend = getattr(settings, 'EMAIL_BACKEND', '')
    if 'console.EmailBackend' in backend:
        return (
            'EMAIL_BACKEND utilise console.EmailBackend: email imprime en console, '
            'pas envoye. Configure EMAIL_HOST_USER et EMAIL_HOST_PASSWORD.'
        )
    if not getattr(settings, 'EMAIL_HOST', None):
        return 'EMAIL_HOST manquant'
    if not getattr(settings, 'EMAIL_HOST_USER', None):
        return 'EMAIL_HOST_USER manquant'
    if not getattr(settings, 'EMAIL_HOST_PASSWORD', None):
        return 'EMAIL_HOST_PASSWORD manquant'
    return None


def _legacy_get_report_data(start_date, end_date):
    """Calcule les données du rapport pour une période"""
    from sales.models import Return, ReturnItem
    start_dt, end_dt = local_datetime_bounds(start_date, end_date)
    tz = timezone.get_current_timezone()

    # Ventes de la période
    sales = Sale.objects.filter(
        created_at__gte=start_dt,
        created_at__lte=end_dt
    )

    # Totaux
    total_sales = sales.count()

    # Articles vendus groupés - prix de vente simple, sans TVA automatique.
    items = SaleItem.objects.filter(
        sale__in=sales
    ).values(
        'product__name', 'product__barcode'
    ).annotate(
        total_qty=Sum('quantity'),
        total_revenue=Sum(F('unit_price_ht') * F('quantity')),
        total_cost=Sum('total_purchase_cost'),
        avg_unit_price=Sum(F('unit_price_ht') * F('quantity')) / Sum('quantity')
    ).order_by('-total_qty')

    # Calcul du bénéfice
    items_sold = []
    total_revenue = Decimal('0')
    total_profit = Decimal('0')
    total_discounts = sales.aggregate(
        total=Sum('discount_amount'),
    )['total'] or Decimal('0')

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
        created_at__gte=start_dt,
        created_at__lte=end_dt
    )

    total_returns = Decimal('0')
    returns_count = completed_returns.count()

    for ret in completed_returns:
        total_returns += ret.refund_amount or Decimal('0')

    # Dépenses d'exploitation rattachées à la période (loyer, salaires, etc.)
    from sales.aggregates import operating_expenses_for_period
    operating_expenses = operating_expenses_for_period(start_date, end_date)

    # Bénéfice net = (prix_vente - prix_achat) - retours - dépenses
    net_revenue = float(total_revenue) - float(total_discounts) - float(total_returns)
    gross_margin = float(total_profit) - float(total_discounts) - float(total_returns)
    net_profit = gross_margin - float(operating_expenses)

    # Données pour le graphique
    from django.db.models.functions import TruncHour, TruncDay

    chart_data = []

    if start_date == end_date:
        # Vue journalière : par heure
        hourly_sales = sales.annotate(
            hour=TruncHour('created_at', tzinfo=tz)
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
            day=TruncDay('created_at', tzinfo=tz)
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
        'total_revenue': net_revenue,       # CA net (après retours)
        'gross_margin': gross_margin,       # Marge brute = revenue - COGS - retours
        'operating_expenses': float(operating_expenses),
        'total_profit': net_profit,         # Bénéfice net = marge brute - dépenses
        'items_sold': items_sold,
        'chart_data': chart_data
    }

    # Ajouter les retours seulement s'il y en a
    if returns_count > 0:
        result['returns_count'] = returns_count
        result['total_returns'] = float(total_returns)
        result['gross_revenue'] = float(total_revenue)  # CA brut (avant retours)

    return result



def get_report_data(start_date, end_date):
    """Build a financially consistent report for a local-date period."""
    from sales.aggregates import (
        _credit_payments_cost,
        _credit_payments_total,
        completed_returns_for_period,
        financials_for_period,
        operating_expenses_for_period,
        recognized_return_effect,
        recognized_refund_expression,
    )
    from django.db.models.functions import TruncDay, TruncHour
    from credit.models import CreditPayment

    start_dt, end_dt = local_datetime_bounds(start_date, end_date)
    tz = timezone.get_current_timezone()
    sales = (
        Sale.objects.filter(created_at__gte=start_dt, created_at__lte=end_dt)
        .exclude(payment_method=Sale.PaymentMethod.CREDIT)
        .prefetch_related('items__product')
    )
    completed_returns = completed_returns_for_period(
        start_date, end_date,
    ).select_related('sale').prefetch_related('items__sale_item__product')
    financials = financials_for_period(start_date, end_date)
    operating_expenses = operating_expenses_for_period(start_date, end_date)
    credit_revenue = _credit_payments_total(start_dt, end_dt)
    credit_cost = _credit_payments_cost(start_dt, end_dt)

    product_rows = {}
    for sale in sales:
        sale_items = sorted(sale.items.all(), key=lambda item: item.pk)
        line_values = [
            item.unit_price_ht * item.quantity for item in sale_items
        ]
        allocated_revenue = _allocate_cents(sale.total_ttc, line_values)
        for item, revenue in zip(sale_items, allocated_revenue):
            cost = item.total_purchase_cost or Decimal('0')
            key = (item.product_id, item.product_name)
            row = product_rows.setdefault(key, {
                'name': item.product_name or 'Produit sans nom',
                'barcode': item.product.barcode if item.product else '',
                'quantity': 0,
                'revenue': Decimal('0'),
                'cost': Decimal('0'),
            })
            row['quantity'] += item.quantity
            row['revenue'] += revenue
            row['cost'] += cost

    if credit_revenue or credit_cost:
        product_rows[(None, 'Règlements crédit')] = {
            'name': 'Règlements crédit',
            'barcode': '',
            'quantity': 0,
            'revenue': credit_revenue,
            'cost': credit_cost,
        }

    for return_order in completed_returns:
        if return_order.sale.payment_method == Sale.PaymentMethod.CREDIT:
            refund_amount, returned_cost = recognized_return_effect(return_order)
            if refund_amount or returned_cost:
                key = (None, 'Règlements crédit')
                row = product_rows.setdefault(key, {
                    'name': 'Règlements crédit',
                    'barcode': '',
                    'quantity': 0,
                    'revenue': Decimal('0'),
                    'cost': Decimal('0'),
                })
                row['revenue'] -= refund_amount
                row['cost'] -= returned_cost
            continue
        return_items = sorted(return_order.items.all(), key=lambda item: item.pk)
        line_values = [
            item.sale_item.unit_price_ht * item.quantity
            for item in return_items
        ]
        allocated_refunds = _allocate_cents(
            return_order.refund_amount,
            line_values,
        )
        for item, refund_share in zip(return_items, allocated_refunds):
            sale_item = item.sale_item
            key = (sale_item.product_id, sale_item.product_name)
            row = product_rows.setdefault(key, {
                'name': sale_item.product_name or 'Produit sans nom',
                'barcode': sale_item.product.barcode if sale_item.product else '',
                'quantity': 0,
                'revenue': Decimal('0'),
                'cost': Decimal('0'),
            })
            row['quantity'] -= item.quantity
            row['revenue'] -= refund_share
            if item.restock:
                row['cost'] -= sale_item.unit_purchase_price * item.quantity

    target_revenue = Decimal(financials['net_revenue']).quantize(
        CENT, rounding=ROUND_HALF_UP,
    )
    target_cost = Decimal(financials['net_cost']).quantize(
        CENT, rounding=ROUND_HALF_UP,
    )
    if not product_rows and (target_revenue or target_cost):
        product_rows[(None, 'Montant non attribue')] = {
            'name': 'Montant non attribue',
            'barcode': '',
            'quantity': 0,
            'revenue': Decimal('0.00'),
            'cost': Decimal('0.00'),
        }

    ordered_keys = sorted(
        product_rows,
        key=lambda key: (
            key[0] is None,
            key[0] if key[0] is not None else 0,
            key[1] or '',
        ),
    )
    for key in ordered_keys:
        row = product_rows[key]
        row['revenue'] = Decimal(row['revenue']).quantize(
            CENT, rounding=ROUND_HALF_UP,
        )
        row['cost'] = Decimal(row['cost']).quantize(
            CENT, rounding=ROUND_HALF_UP,
        )
    if ordered_keys:
        residual_row = product_rows[ordered_keys[-1]]
        residual_row['revenue'] += target_revenue - sum(
            (product_rows[key]['revenue'] for key in ordered_keys),
            Decimal('0.00'),
        )
        residual_row['cost'] += target_cost - sum(
            (product_rows[key]['cost'] for key in ordered_keys),
            Decimal('0.00'),
        )

    items_sold = []
    for key in ordered_keys:
        row = product_rows[key]
        quantity = row['quantity']
        unit_price = row['revenue'] / quantity if quantity > 0 else Decimal('0')
        items_sold.append({
            **row,
            'unit_price': float(unit_price),
            'revenue': float(row['revenue']),
            'cost': float(row['cost']),
            'profit': float(row['revenue'] - row['cost']),
        })
    items_sold.sort(key=lambda row: (-row['quantity'], row['name']))

    chart_data = []
    if start_date == end_date:
        hourly_sales = sales.annotate(
            bucket=TruncHour('created_at', tzinfo=tz),
        ).values('bucket').annotate(revenue=Sum('total_ttc'), count=Count('id'))
        hourly_credit = CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
            status=CreditPayment.PaymentStatus.ACTIVE,
        ).annotate(bucket=TruncHour('created_at', tzinfo=tz)).values(
            'bucket',
        ).annotate(revenue=Sum('amount'), count=Count('id'))
        hourly_returns = completed_returns.annotate(
            bucket=TruncHour('completed_at', tzinfo=tz),
        ).values('bucket').annotate(
            refunds=Sum(recognized_refund_expression()),
            returns_count=Count('id'),
        )
        sales_by_hour = {
            row['bucket'].hour: row for row in hourly_sales if row['bucket']
        }
        credit_by_hour = {
            row['bucket'].hour: row for row in hourly_credit if row['bucket']
        }
        returns_by_hour = {
            row['bucket'].hour: row for row in hourly_returns if row['bucket']
        }
        for hour in range(24):
            sale_point = sales_by_hour.get(hour, {})
            credit_point = credit_by_hour.get(hour, {})
            return_point = returns_by_hour.get(hour, {})
            chart_data.append({
                'label': f'{hour:02d}h',
                'revenue': float(
                    (sale_point.get('revenue') or 0)
                    + (credit_point.get('revenue') or 0)
                    - (return_point.get('refunds') or 0)
                ),
                'count': sale_point.get('count', 0) + credit_point.get('count', 0),
                'returns_count': return_point.get('returns_count', 0),
            })
    else:
        daily_sales = sales.annotate(
            bucket=TruncDay('created_at', tzinfo=tz),
        ).values('bucket').annotate(revenue=Sum('total_ttc'), count=Count('id'))
        daily_credit = CreditPayment.objects.filter(
            created_at__gte=start_dt,
            created_at__lte=end_dt,
            status=CreditPayment.PaymentStatus.ACTIVE,
        ).annotate(bucket=TruncDay('created_at', tzinfo=tz)).values(
            'bucket',
        ).annotate(revenue=Sum('amount'), count=Count('id'))
        daily_returns = completed_returns.annotate(
            bucket=TruncDay('completed_at', tzinfo=tz),
        ).values('bucket').annotate(
            refunds=Sum(recognized_refund_expression()),
            returns_count=Count('id'),
        )
        sales_by_day = {
            row['bucket'].date(): row for row in daily_sales if row['bucket']
        }
        credit_by_day = {
            row['bucket'].date(): row for row in daily_credit if row['bucket']
        }
        returns_by_day = {
            row['bucket'].date(): row for row in daily_returns if row['bucket']
        }
        current = start_date
        while current <= end_date:
            sale_point = sales_by_day.get(current, {})
            credit_point = credit_by_day.get(current, {})
            return_point = returns_by_day.get(current, {})
            chart_data.append({
                'label': current.strftime('%d/%m'),
                'revenue': float(
                    (sale_point.get('revenue') or 0)
                    + (credit_point.get('revenue') or 0)
                    - (return_point.get('refunds') or 0)
                ),
                'count': sale_point.get('count', 0) + credit_point.get('count', 0),
                'returns_count': return_point.get('returns_count', 0),
            })
            current += timedelta(days=1)

    return {
        'total_sales': financials['sales_count'],
        'total_revenue': float(financials['net_revenue']),
        'gross_revenue': float(financials['gross_revenue']),
        'total_returns': float(financials['refunds']),
        'returns_count': financials['returns_count'],
        'gross_cost': float(financials['gross_cost']),
        'returned_cost': float(financials['returned_cost']),
        'net_cost': float(financials['net_cost']),
        'gross_margin': float(financials['gross_margin']),
        'operating_expenses': float(operating_expenses),
        'total_profit': float(financials['gross_margin'] - operating_expenses),
        'items_sold': items_sold,
        'chart_data': chart_data,
    }


def send_report_email(report_type, start_date, end_date, data, recipients):
    """Envoie le rapport par email avec configuration SMTP dynamique"""

    config_error = email_config_error()
    if config_error:
        return False, config_error

    subject_map = {
        'DAILY': f'Rapport Journalier - {end_date.strftime("%d/%m/%Y")}',
        'WEEKLY': f'Rapport Hebdomadaire - Semaine du {start_date.strftime("%d/%m/%Y")}',
        'MONTHLY': f'Rapport Mensuel - {start_date.strftime("%B %Y")}',
        'QUARTERLY': f'Rapport Trimestriel - Q{(start_date.month-1)//3+1} {start_date.year}',
        'YEARLY': f'Rapport Annuel - {start_date.year}'
    }

    app_settings = AppSettings.get_settings()
    store_name = app_settings.store_name or 'Librairie'
    currency_symbol = str(app_settings.currency_symbol or 'DH').strip() or 'DH'
    safe_currency_symbol = escape(currency_symbol)
    subject = f"[{store_name}] {subject_map.get(report_type, 'Rapport')}"

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
                <div class="stat-value">{data['total_revenue']:.2f} {safe_currency_symbol}</div>
            </div>

            <div class="stat">
                <div>Bénéfice</div>
                <div class="stat-value profit">{data['total_profit']:.2f} {safe_currency_symbol}</div>
            </div>

            <h3>📦 Articles vendus</h3>
            <table>
                <thead>
                    <tr>
                        <th>Produit</th>
                        <th style="text-align: right;">Prix moyen vendu</th>
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
                        <td>{escape(item['name'])}</td>
                        <td style="text-align: right;">{item['unit_price']:.2f} {safe_currency_symbol}</td>
                        <td style="text-align: center;">{item['quantity']}</td>
                        <td style="text-align: right;">{item['revenue']:.2f} {safe_currency_symbol}</td>
                        <td style="text-align: right;" class="profit">{item['profit']:.2f} {safe_currency_symbol}</td>
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

    # SMTP credentials come from Django settings (env-driven).
    try:
        send_mail(
            subject=subject,
            message=(
                f"Rapport {report_type} - CA: {data['total_revenue']:.2f} "
                f"{currency_symbol}, Bénéfice: {data['total_profit']:.2f} "
                f"{currency_symbol}"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            html_message=html_message,
            fail_silently=False,
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
        ReportLog.objects.create(
            report_type='DAILY',
            period_start=timezone.localdate(),
            period_end=timezone.localdate(),
            total_sales=0,
            total_revenue=0,
            total_profit=0,
            items_sold=[],
            recipients='',
            success=False,
            error_message='No recipients configured',
        )
        return "No recipients configured"

    today = timezone.localdate()
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

    today = timezone.localdate()
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

    today = timezone.localdate()
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

    today = timezone.localdate()
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

    today = timezone.localdate()
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
        stock__lte=F('min_stock'),
        active=True
    ).order_by('stock')

    if not low_stock_products.exists():
        return "No low stock products"

    config_error = email_config_error()
    if config_error:
        return f"Error sending low stock alert: {config_error}"

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
                        <td>{escape(product.name)}</td>
                        <td>{escape(product.barcode)}</td>
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

    # SMTP credentials come from Django settings (env-driven).
    try:
        send_mail(
            subject=f"⚠️ [Librairie] Alerte Stock Bas - {low_stock_products.count()} produits",
            message=f"{low_stock_products.count()} produits sont en stock bas.",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            html_message=html_message,
            fail_silently=False,
        )
        return f"Low stock alert sent for {low_stock_products.count()} products"
    except Exception as e:
        return f"Error sending low stock alert: {str(e)}"


@shared_task
def daily_database_backup():
    """Create an encrypted, restorable database + media archive.

    ``BACKUP_ENCRYPTION_KEY`` must be a URL-safe base64 encoded 32-byte key.
    The task fails closed when the key is missing or invalid. Archives use a
    streaming AES-256-GCM envelope and are retained for 30 days by default.
    ``BACKUP_OFFSITE_DIR`` optionally receives an atomic filesystem copy.
    ``BACKUP_S3_BUCKET`` enables a verified S3-compatible copy with durable
    retry of every retained local archive. A remote failure never removes a
    pending local archive.
    """
    import hashlib
    import json
    import os
    import secrets
    import shutil
    import sqlite3
    import tempfile
    import zipfile
    from contextlib import closing
    from pathlib import Path, PurePosixPath

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    now = timezone.localtime()
    backup_dir = secure_backup_directory()
    output_path = None
    temporary_output = None
    backup_finalized = False
    offsite_errors = []
    offsite_success = False
    s3_enabled = bool(os.environ.get('BACKUP_S3_BUCKET', '').strip())
    s3_confirmed = frozenset()

    try:
        def file_sha256(path):
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            return digest.hexdigest()

        def fsync_directory(path):
            if os.name == 'nt':
                return
            flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
            descriptor = os.open(path, flags)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)

        retention_days = max(
            1, min(3650, int(os.environ.get('BACKUP_RETENTION_DAYS', '30'))),
        )
        cutoff = now - timedelta(days=retention_days)

        def expired_local_archives(excluded=None):
            expired = set()
            for candidate in backup_dir.glob('libtak_backup_*.ltbk'):
                try:
                    if (
                        candidate.resolve().parent != backup_dir
                        or candidate == excluded
                    ):
                        continue
                    modified = datetime.fromtimestamp(
                        candidate.stat().st_mtime, tz=now.tzinfo,
                    )
                except FileNotFoundError:
                    continue
                if modified < cutoff:
                    expired.add(candidate)
            return expired

        def purge_expired_local(confirmed, excluded=None):
            for candidate in expired_local_archives(excluded):
                if s3_enabled and candidate not in confirmed:
                    continue
                candidate.unlink(missing_ok=True)
                remove_s3_marker(candidate)

        def archive_file(archive, path, arcname):
            """Write and hash exactly the same byte stream.

            Hashing the source in a second pass can produce a manifest that
            does not match the ZIP when an upload changes during the backup.
            """
            digest = hashlib.sha256()
            with archive.open(arcname, 'w', force_zip64=True) as target:
                with path.open('rb') as source:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
                        digest.update(chunk)
            return digest.hexdigest()

        def validate_sqlite_snapshot(connection):
            integrity = connection.execute('PRAGMA integrity_check').fetchone()
            if not integrity or integrity[0] != 'ok':
                raise ValueError('Configured SQLite database failed integrity_check.')
            required_tables = {'django_migrations', 'core_user'}
            present_tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if not required_tables.issubset(present_tables):
                raise ValueError('Configured SQLite file is not a LibTak database.')

        encryption_key = encryption_key_from_env()

        backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(backup_dir, 0o700)

        # Retry and prune already-confirmed remote copies before allocating a
        # new archive. This lets the system recover automatically when a long
        # S3 outage had filled the local backup volume.
        if s3_enabled:
            try:
                preflight_expired = expired_local_archives()
                preflight_result = sync_encrypted_backups_to_s3(
                    backup_dir,
                    force_body_verification=preflight_expired,
                )
                s3_confirmed = preflight_result.confirmed
                purge_expired_local(s3_confirmed)
                if preflight_result.errors:
                    preflight_error = (
                        's3 preflight: ' + ', '.join(preflight_result.errors)
                    )
                    offsite_errors.append(preflight_error)
                    logger.warning(
                        'Encrypted S3 backup preflight was incomplete; '
                        'unconfirmed local archives retained: %s',
                        preflight_error,
                    )
            except Exception as exc:
                preflight_error = f's3 preflight: {safe_s3_error(exc)}'
                offsite_errors.append(preflight_error)
                logger.warning(
                    'Encrypted S3 backup preflight failed; local archives '
                    'retained: %s',
                    preflight_error,
                )

        minimum_free_bytes = max(
            0,
            min(
                1024**5,
                int(os.environ.get('BACKUP_MIN_FREE_BYTES', str(256 * 1024**2))),
            ),
        )
        storage_locations = {
            backup_dir,
            Path(tempfile.gettempdir()).expanduser().resolve(),
        }
        for storage_location in storage_locations:
            available = shutil.disk_usage(storage_location).free
            if available < minimum_free_bytes:
                raise OSError(
                    'Insufficient free space for a safe backup: '
                    f'{available} bytes available, '
                    f'{minimum_free_bytes} bytes reserved.'
                )

        timestamp = now.strftime('%Y-%m-%d_%H-%M-%S_%f')
        unique_suffix = secrets.token_hex(8)
        output_path = backup_dir / (
            f'libtak_backup_{timestamp}_{unique_suffix}.ltbk'
        )
        temporary_output = backup_dir / (
            f'.{output_path.name}.{secrets.token_hex(8)}.tmp'
        )

        with tempfile.TemporaryDirectory(prefix='libtak-backup-') as temp_name:
            temp_dir = Path(temp_name)
            database_name = 'database.sqlite3'
            database_path = temp_dir / database_name
            vendor = settings.DATABASES['default']['ENGINE']

            if vendor.endswith('sqlite3'):
                source_path = Path(settings.DATABASES['default']['NAME']).resolve()
                if not source_path.is_file():
                    raise FileNotFoundError(
                        'Configured SQLite database file does not exist.'
                    )
                source_uri = source_path.as_uri() + '?mode=ro'
                with closing(sqlite3.connect(source_uri, uri=True)) as source, closing(
                    sqlite3.connect(database_path)
                ) as target:
                    source.backup(target)
                    validate_sqlite_snapshot(target)
            else:
                database_name = 'database.json'
                database_path = temp_dir / database_name
                _dump_database_fixture(database_path)

            archive_path = temp_dir / 'backup.zip'
            checksums = {}
            media_root = Path(settings.MEDIA_ROOT).resolve()
            with zipfile.ZipFile(
                archive_path, 'w', compression=zipfile.ZIP_DEFLATED,
            ) as archive:
                checksums[database_name] = archive_file(
                    archive, database_path, database_name,
                )
                if media_root.exists():
                    for media_file in media_root.rglob('*'):
                        if not media_file.is_file() or media_file.is_symlink():
                            continue
                        relative = media_file.relative_to(media_root)
                        arcname = str(PurePosixPath('media', *relative.parts))
                        checksums[arcname] = archive_file(
                            archive, media_file, arcname,
                        )
                manifest = {
                    'format': 1,
                    'created_at': now.isoformat(),
                    'database_engine': vendor,
                    'files_sha256': checksums,
                }
                archive.writestr(
                    'manifest.json',
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                )

            nonce = secrets.token_bytes(12)
            encryptor = Cipher(
                algorithms.AES(encryption_key), modes.GCM(nonce),
            ).encryptor()
            with archive_path.open('rb') as source, temporary_output.open('xb') as target:
                target.write(b'LTBK1')
                target.write(nonce)
                while chunk := source.read(1024 * 1024):
                    target.write(encryptor.update(chunk))
                target.write(encryptor.finalize())
                target.write(encryptor.tag)
                target.flush()
                os.fsync(target.fileno())
            os.chmod(temporary_output, 0o600)
            verified_archive = temp_dir / 'verified-backup.zip'
            decrypt_archive(temporary_output, verified_archive)
            validate_zip_archive(verified_archive)
            os.replace(temporary_output, output_path)
            fsync_directory(backup_dir)
            backup_finalized = True

        if s3_enabled:
            try:
                verify_before_purge = expired_local_archives(output_path)
                s3_result = sync_encrypted_backups_to_s3(
                    backup_dir,
                    force_body_verification=verify_before_purge,
                )
                s3_confirmed = s3_result.confirmed
                if output_path in s3_confirmed:
                    offsite_success = True
                if s3_result.errors:
                    s3_error = 's3: ' + ', '.join(s3_result.errors)
                    offsite_errors.append(s3_error)
                    logger.warning(
                        'Encrypted S3 backup synchronization was incomplete; '
                        'pending local archives retained: %s',
                        s3_error,
                    )
            except Exception as exc:
                s3_error = f's3: {safe_s3_error(exc)}'
                offsite_errors.append(s3_error)
                logger.warning(
                    'Encrypted S3 backup synchronization failed; pending local '
                    'archives retained: %s',
                    s3_error,
                )

        purge_expired_local(s3_confirmed, output_path)

        offsite_dir_value = os.environ.get('BACKUP_OFFSITE_DIR', '').strip()
        if offsite_dir_value:
            offsite_temporary = None
            try:
                offsite_dir = Path(offsite_dir_value).expanduser().resolve()
                if offsite_dir == backup_dir:
                    raise ValueError(
                        'BACKUP_OFFSITE_DIR must differ from the local backup directory.'
                    )
                offsite_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
                os.chmod(offsite_dir, 0o700)
                offsite_path = offsite_dir / output_path.name
                offsite_temporary = offsite_dir / (
                    f'.{output_path.name}.{secrets.token_hex(8)}.tmp'
                )
                with output_path.open('rb') as source, offsite_temporary.open('xb') as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                os.chmod(offsite_temporary, 0o600)
                if file_sha256(offsite_temporary) != file_sha256(output_path):
                    raise OSError('Off-site backup checksum mismatch.')
                os.replace(offsite_temporary, offsite_path)
                fsync_directory(offsite_dir)
                offsite_success = True

                for candidate in offsite_dir.glob('libtak_backup_*.ltbk'):
                    try:
                        if (
                            candidate.resolve().parent != offsite_dir
                            or candidate == offsite_path
                        ):
                            continue
                        modified = datetime.fromtimestamp(
                            candidate.stat().st_mtime, tz=now.tzinfo,
                        )
                    except FileNotFoundError:
                        continue
                    if modified < cutoff:
                        candidate.unlink(missing_ok=True)
            except Exception as exc:
                if offsite_temporary and offsite_temporary.exists():
                    offsite_temporary.unlink()
                directory_error = f'directory: {type(exc).__name__}: {exc}'
                offsite_errors.append(directory_error)
                logger.warning(
                    'Encrypted off-site backup copy failed; local archive retained: %s',
                    directory_error,
                )

        offsite_error = '; '.join(offsite_errors)
        ReportLog.objects.create(
            report_type=ReportLog.ReportType.BACKUP,
            period_start=now.date(),
            period_end=now.date(),
            total_sales=0,
            total_revenue=0,
            total_profit=0,
            items_sold=[],
            recipients=(
                'encrypted-local-and-offsite-storage'
                if offsite_success
                else 'encrypted-local-storage'
            ),
            success=True,
            error_message=offsite_error,
        )
        return f'Backup created: {output_path}'
    except Exception as exc:
        if temporary_output and temporary_output.exists():
            temporary_output.unlink()
        if output_path and output_path.exists() and not backup_finalized:
            output_path.unlink()
        ReportLog.objects.create(
            report_type=ReportLog.ReportType.BACKUP,
            period_start=timezone.localdate(),
            period_end=timezone.localdate(),
            total_sales=0,
            total_revenue=0,
            total_profit=0,
            items_sold=[],
            recipients='encrypted-local-storage',
            success=False,
            error_message=str(exc),
        )
        return f'Backup failed: {exc}'
