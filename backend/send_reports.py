#!/usr/bin/env python
"""
Script d'envoi automatique des rapports et sauvegarde de la base de données.
Ce script est conçu pour être exécuté quotidiennement via les Scheduled Tasks de PythonAnywhere.

Il vérifie les paramètres dans ReportSettings et envoie les rapports appropriés :
- Quotidien : tous les jours
- Hebdomadaire : le jour configuré (par défaut dimanche)
- Mensuel : le dernier jour du mois
- Trimestriel : fin mars, juin, septembre, décembre
- Annuel : le 31 décembre

Usage: python send_reports.py
"""

import os
import sys
import smtplib
import shutil
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from datetime import datetime, timedelta
from io import BytesIO
from decimal import Decimal

# Configuration Django
sys.path.insert(0, '/home/dido22/libtak/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.utils import timezone
from django.db.models import Sum, F
from reporting.models import ReportSettings, ReportLog
from sales.models import Sale, SaleItem, Return
from inventory.models import Product

# ReportLab imports for PDF generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_CENTER, TA_RIGHT


def get_report_data(start_date, end_date):
    """Récupère les données du rapport pour une période donnée."""
    sales = Sale.objects.filter(
        created_at__date__gte=start_date,
        created_at__date__lte=end_date
    )
    
    returns = Return.objects.filter(
        created_at__date__gte=start_date,
        created_at__date__lte=end_date
    )
    
    total_sales = sales.count()
    gross_revenue = float(sales.aggregate(total=Sum('total_ttc'))['total'] or 0)
    returns_amount = float(returns.aggregate(total=Sum('total_ttc'))['total'] or 0)
    total_revenue = gross_revenue - returns_amount
    
    # Calcul du profit
    total_profit = 0
    items_sold = []
    
    sale_items = SaleItem.objects.filter(sale__in=sales).select_related('product')
    for item in sale_items:
        if item.product:
            cost = float(item.product.purchase_price) * item.quantity
            revenue = float(item.unit_price) * item.quantity
            profit = revenue - cost
            total_profit += profit
            
            items_sold.append({
                'name': item.product.name,
                'barcode': item.product.barcode,
                'quantity': item.quantity,
                'unit_price': float(item.unit_price),
                'revenue': revenue,
                'profit': profit
            })
    
    return {
        'period_start': start_date,
        'period_end': end_date,
        'total_sales': total_sales,
        'gross_revenue': gross_revenue,
        'returns_amount': returns_amount,
        'total_revenue': total_revenue,
        'total_profit': total_profit,
        'items_sold': items_sold
    }


def generate_pdf_report(data, report_type):
    """Génère un PDF du rapport."""
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Titre
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#6366f1'),
        spaceAfter=30,
        alignment=TA_CENTER
    )
    
    type_labels = {
        'DAILY': 'Journalier',
        'WEEKLY': 'Hebdomadaire',
        'MONTHLY': 'Mensuel',
        'QUARTERLY': 'Trimestriel',
        'YEARLY': 'Annuel'
    }
    
    title = f"Rapport {type_labels.get(report_type, report_type)}"
    elements.append(Paragraph(title, title_style))
    
    # Période
    period_style = ParagraphStyle(
        'Period',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.gray,
        alignment=TA_CENTER,
        spaceAfter=20
    )
    period_text = f"Du {data['period_start'].strftime('%d/%m/%Y')} au {data['period_end'].strftime('%d/%m/%Y')}"
    elements.append(Paragraph(period_text, period_style))
    elements.append(Spacer(1, 20))
    
    # Résumé
    summary_data = [
        ['Indicateur', 'Valeur'],
        ['Nombre de ventes', str(data['total_sales'])],
        ['Chiffre d\'affaires brut', f"{data['gross_revenue']:.2f} MAD"],
        ['Retours', f"-{data['returns_amount']:.2f} MAD"],
        ['Chiffre d\'affaires net', f"{data['total_revenue']:.2f} MAD"],
        ['Bénéfice total', f"{data['total_profit']:.2f} MAD"],
    ]
    
    summary_table = Table(summary_data, colWidths=[10*cm, 6*cm])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#6366f1')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 30))
    
    # Top 10 produits vendus
    if data['items_sold']:
        elements.append(Paragraph("Top 10 Produits Vendus", styles['Heading2']))
        elements.append(Spacer(1, 10))
        
        # Agréger par produit
        product_summary = {}
        for item in data['items_sold']:
            name = item['name']
            if name not in product_summary:
                product_summary[name] = {'quantity': 0, 'revenue': 0, 'profit': 0}
            product_summary[name]['quantity'] += item['quantity']
            product_summary[name]['revenue'] += item['revenue']
            product_summary[name]['profit'] += item['profit']
        
        # Trier par quantité et prendre top 10
        sorted_products = sorted(product_summary.items(), key=lambda x: x[1]['quantity'], reverse=True)[:10]
        
        product_data = [['Produit', 'Quantité', 'CA', 'Bénéfice']]
        for name, stats in sorted_products:
            product_data.append([
                name[:30],  # Tronquer les noms longs
                str(stats['quantity']),
                f"{stats['revenue']:.2f} MAD",
                f"{stats['profit']:.2f} MAD"
            ])
        
        product_table = Table(product_data, colWidths=[8*cm, 2.5*cm, 3*cm, 3*cm])
        product_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8b5cf6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
        ]))
        elements.append(product_table)
    
    # Générer le PDF
    doc.build(elements)
    buffer.seek(0)
    return buffer


def send_email(settings, subject, body, attachments=None):
    """Envoie un email avec les pièces jointes."""
    if not settings.sender_email or not settings.sender_password:
        print("❌ Email expéditeur non configuré")
        return False
    
    recipients = settings.get_recipients_list()
    if not recipients:
        print("❌ Aucun destinataire configuré")
        return False
    
    try:
        msg = MIMEMultipart()
        msg['From'] = settings.sender_email
        msg['To'] = ', '.join(recipients)
        msg['Subject'] = subject
        
        msg.attach(MIMEText(body, 'html'))
        
        if attachments:
            for filename, content in attachments:
                attachment = MIMEApplication(content.read() if hasattr(content, 'read') else content)
                attachment.add_header('Content-Disposition', 'attachment', filename=filename)
                msg.attach(attachment)
        
        # Connexion SMTP
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.sender_email, settings.sender_password)
            server.send_message(msg)
        
        print(f"✅ Email envoyé à: {', '.join(recipients)}")
        return True
        
    except Exception as e:
        print(f"❌ Erreur d'envoi: {str(e)}")
        return False


def backup_database():
    """Crée une sauvegarde de la base de données SQLite."""
    source_db = '/home/dido22/libtak/backend/db.sqlite3'
    backup_dir = '/home/dido22/backups'
    
    # Créer le dossier de backup s'il n'existe pas
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_filename = f'libtak_backup_{timestamp}.sqlite3'
    backup_path = os.path.join(backup_dir, backup_filename)
    
    try:
        shutil.copy2(source_db, backup_path)
        print(f"✅ Backup créé: {backup_path}")
        
        # Garder seulement les 7 derniers backups
        backups = sorted([f for f in os.listdir(backup_dir) if f.startswith('libtak_backup_')])
        while len(backups) > 7:
            old_backup = backups.pop(0)
            os.remove(os.path.join(backup_dir, old_backup))
            print(f"🗑️ Ancien backup supprimé: {old_backup}")
        
        return backup_path
    except Exception as e:
        print(f"❌ Erreur de backup: {str(e)}")
        return None


def should_send_report(report_type, settings, today):
    """Détermine si un rapport doit être envoyé aujourd'hui."""
    if report_type == 'DAILY':
        return settings.daily_enabled
    
    elif report_type == 'WEEKLY':
        # weekly_day: 0=Lundi, 6=Dimanche
        return settings.weekly_enabled and today.weekday() == settings.weekly_day
    
    elif report_type == 'MONTHLY':
        # Dernier jour du mois
        tomorrow = today + timedelta(days=1)
        return settings.monthly_enabled and tomorrow.month != today.month
    
    elif report_type == 'QUARTERLY':
        # Fin de trimestre: 31 mars, 30 juin, 30 sept, 31 déc
        tomorrow = today + timedelta(days=1)
        is_end_of_quarter = (today.month in [3, 6, 9, 12]) and (tomorrow.month != today.month)
        return settings.quarterly_enabled and is_end_of_quarter
    
    elif report_type == 'YEARLY':
        # 31 décembre
        return settings.yearly_enabled and today.month == 12 and today.day == 31
    
    return False


def get_period_dates(report_type, today):
    """Retourne les dates de début et fin de période pour un type de rapport."""
    if report_type == 'DAILY':
        return today, today
    
    elif report_type == 'WEEKLY':
        # 7 derniers jours
        start = today - timedelta(days=6)
        return start, today
    
    elif report_type == 'MONTHLY':
        # Mois courant
        start = today.replace(day=1)
        return start, today
    
    elif report_type == 'QUARTERLY':
        # Trimestre courant
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        start = today.replace(month=quarter_month, day=1)
        return start, today
    
    elif report_type == 'YEARLY':
        # Année courante
        start = today.replace(month=1, day=1)
        return start, today
    
    return today, today


def main():
    """Fonction principale."""
    print(f"\n{'='*60}")
    print(f"📧 ENVOI AUTOMATIQUE DES RAPPORTS")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")
    
    # Charger les paramètres
    settings = ReportSettings.get_settings()
    today = timezone.now().date()
    
    print(f"📬 Destinataires: {settings.get_recipients_list()}")
    print(f"📤 Expéditeur: {settings.sender_email}")
    print()
    
    # Liste des rapports à envoyer
    reports_to_send = []
    
    for report_type in ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']:
        if should_send_report(report_type, settings, today):
            reports_to_send.append(report_type)
    
    if not reports_to_send:
        print("ℹ️ Aucun rapport à envoyer aujourd'hui")
        # Créer le backup quand même
        backup_database()
        return
    
    print(f"📊 Rapports à envoyer: {', '.join(reports_to_send)}")
    print()
    
    # Générer et envoyer les rapports
    attachments = []
    
    for report_type in reports_to_send:
        start_date, end_date = get_period_dates(report_type, today)
        data = get_report_data(start_date, end_date)
        
        print(f"📈 Génération du rapport {report_type}...")
        pdf_buffer = generate_pdf_report(data, report_type)
        
        type_labels = {
            'DAILY': 'Journalier',
            'WEEKLY': 'Hebdomadaire',
            'MONTHLY': 'Mensuel',
            'QUARTERLY': 'Trimestriel',
            'YEARLY': 'Annuel'
        }
        filename = f"Rapport_{type_labels[report_type]}_{today.strftime('%Y%m%d')}.pdf"
        attachments.append((filename, pdf_buffer))
        
        # Log dans la base de données
        ReportLog.objects.create(
            report_type=report_type,
            period_start=start_date,
            period_end=end_date,
            total_sales=data['total_sales'],
            total_revenue=Decimal(str(data['total_revenue'])),
            total_profit=Decimal(str(data['total_profit'])),
            items_sold={'count': len(data['items_sold'])},
            recipients=', '.join(settings.get_recipients_list()),
            success=True
        )
    
    # Ajouter le backup de la base de données
    backup_path = backup_database()
    if backup_path:
        with open(backup_path, 'rb') as f:
            backup_content = f.read()
        attachments.append((os.path.basename(backup_path), backup_content))
    
    # Construire l'email
    subject = f"📊 LibTak - Rapports du {today.strftime('%d/%m/%Y')}"
    
    body = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 20px; border-radius: 10px; color: white;">
            <h1 style="margin: 0;">📊 Rapports LibTak</h1>
            <p style="margin: 5px 0 0 0;">{today.strftime('%d %B %Y')}</p>
        </div>
        
        <div style="padding: 20px;">
            <p>Bonjour,</p>
            <p>Veuillez trouver ci-joint les rapports suivants :</p>
            <ul>
                {''.join([f'<li>Rapport {type_labels[r]}</li>' for r in reports_to_send])}
                {'<li>Sauvegarde de la base de données</li>' if backup_path else ''}
            </ul>
            <p style="color: #666; font-size: 12px; margin-top: 30px;">
                Ce message a été envoyé automatiquement par LibTak.<br>
                Librairie Attaquaddoum
            </p>
        </div>
    </body>
    </html>
    """
    
    # Envoyer l'email
    type_labels = {
        'DAILY': 'Journalier',
        'WEEKLY': 'Hebdomadaire',
        'MONTHLY': 'Mensuel',
        'QUARTERLY': 'Trimestriel',
        'YEARLY': 'Annuel'
    }
    success = send_email(settings, subject, body, attachments)
    
    if success:
        print("\n✅ Tous les rapports ont été envoyés avec succès !")
    else:
        print("\n❌ Erreur lors de l'envoi des rapports")
    
    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
