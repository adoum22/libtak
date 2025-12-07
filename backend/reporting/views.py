from rest_framework.views import APIView
from rest_framework import generics, viewsets
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from django.db.models import Sum, Count, F
from django.utils import timezone
from datetime import timedelta, datetime
from decimal import Decimal

from sales.models import Sale, SaleItem
from inventory.models import Product
from core.permissions import IsAdminRole, CanAccessReports
from django.http import HttpResponse
from .models import ReportSettings, ReportLog
from .serializers import ReportSettingsSerializer, ReportLogSerializer
from .tasks import get_report_data
import logging

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from io import BytesIO

class ExportReportView(APIView):
    """Générer un PDF du rapport (Via ReportLab pour compatibilité Windows)"""
    permission_classes = [IsAuthenticated, CanAccessReports]

    def get(self, request):
        # Paramètres
        report_type = request.query_params.get('type', 'daily')
        today = timezone.now().date()

        if report_type == 'daily':
            date_str = request.query_params.get('date')
            start_date = end_date = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else today
        elif report_type == 'weekly':
            week_offset = int(request.query_params.get('week_offset', 0))
            end_date = today - timedelta(days=7 * week_offset)
            start_date = end_date - timedelta(days=6)
        elif report_type == 'monthly':
            month = int(request.query_params.get('month', today.month))
            year = int(request.query_params.get('year', today.year))
            start_date = today.replace(year=year, month=month, day=1)
            if month == 12:
                end_date = start_date.replace(year=year+1, month=1, day=1) - timedelta(days=1)
            else:
                end_date = start_date.replace(month=month+1, day=1) - timedelta(days=1)
        
        # Données
        data = get_report_data(start_date, end_date)

        try:
            # Création du PDF
            buffer = BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
            
            elements = []
            styles = getSampleStyleSheet()
            
            # Titre
            title_style = ParagraphStyle(
                'Title',
                parent=styles['Heading1'],
                fontSize=24,
                textColor=colors.HexColor('#1e40af'),
                spaceAfter=20,
                alignment=1 # Center
            )
            elements.append(Paragraph(f"Rapport {report_type.capitalize()}", title_style))
            
            # Sous-titre Période
            period_style = ParagraphStyle(
                'Period',
                parent=styles['Normal'],
                fontSize=12,
                textColor=colors.gray,
                alignment=1,
                spaceAfter=30
            )
            period_str = f"Période du {start_date.strftime('%d/%m/%Y')} au {end_date.strftime('%d/%m/%Y')}"
            elements.append(Paragraph(period_str, period_style))

            # Résumé (Tableau stats)
            summary_data = [
                ['Ventes', "CA", "Bénéfice Net"],
                [str(data['total_sales']), f"{data['total_revenue']:.2f} DH", f"{data['total_profit']:.2f} DH"]
            ]
            
            summary_table = Table(summary_data, colWidths=[5*cm, 5*cm, 5*cm])
            summary_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 12),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, 1), colors.white),
                ('TEXTCOLOR', (0, 1), (1, 1), colors.black),
                ('TEXTCOLOR', (2, 1), (2, 1), colors.green), # Profit en vert
                ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 1), (-1, 1), 14),
                ('TOPPADDING', (0, 1), (-1, 1), 12),
                ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#e5e7eb')),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ]))
            elements.append(summary_table)
            elements.append(Spacer(1, 30))

            # Détail des ventes
            elements.append(Paragraph("Détail des produits vendus", styles['Heading2']))
            elements.append(Spacer(1, 10))

            # En-têtes tableau produits
            table_data = [['Produit', 'Qté', 'CA', 'Marge']]
            
            for item in data['items_sold']:
                table_data.append([
                    item['name'][:40] + ('...' if len(item['name']) > 40 else ''), # Tronquer noms longs
                    str(item['quantity']),
                    f"{item['revenue']:.2f}",
                    f"{item['profit']:.2f}"
                ])
                
            # Création tableau produits
            row_count = len(table_data)
            product_table = Table(table_data, colWidths=[9*cm, 2*cm, 3*cm, 3*cm])
            
            product_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e40af')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('ALIGN', (0, 0), (0, -1), 'LEFT'), # Produit aligné gauche
                ('ALIGN', (1, 0), (-1, -1), 'RIGHT'), # Chiffres alignés droite
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
                ('TOPPADDING', (0, 0), (-1, 0), 8),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
                ('TEXTCOLOR', (-1, 1), (-1, -1), colors.green), # Colonne Marge en vert
            ]))
            
            elements.append(product_table)
            
            # Footer
            elements.append(Spacer(1, 40))
            footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=8, textColor=colors.gray, alignment=1)
            elements.append(Paragraph(f"Généré automatiquement par Librairie App le {timezone.now().strftime('%d/%m/%Y à %H:%M')}", footer_style))

            # Build
            doc.build(elements)
            pdf = buffer.getvalue()
            buffer.close()

            response = HttpResponse(content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="rapport_{report_type}_{start_date}.pdf"'
            response.write(pdf)
            
            return response

        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'detail': f"Erreur PDF: {str(e)}"}, status=500)


class DailyReportView(APIView):
    """Rapport journalier"""
    permission_classes = [IsAuthenticated, CanAccessReports]

    def get(self, request):
        date_str = request.query_params.get('date')
        if date_str:
            from datetime import datetime
            date = datetime.strptime(date_str, '%Y-%m-%d').date()
        else:
            date = timezone.now().date()
        
        data = get_report_data(date, date)
        data['date'] = date
        
        return Response(data)


class WeeklyReportView(APIView):
    """Rapport hebdomadaire"""
    permission_classes = [IsAuthenticated, CanAccessReports]

    def get(self, request):
        today = timezone.now().date()
        
        # Semaine demandée ou courante
        week_offset = int(request.query_params.get('week_offset', 0))
        end_date = today - timedelta(days=7 * week_offset)
        start_date = end_date - timedelta(days=6)
        
        data = get_report_data(start_date, end_date)
        data['period_start'] = start_date
        data['period_end'] = end_date
        
        return Response(data)


class MonthlyReportView(APIView):
    """Rapport mensuel"""
    permission_classes = [IsAuthenticated, CanAccessReports]

    def get(self, request):
        today = timezone.now().date()
        
        month = int(request.query_params.get('month', today.month))
        year = int(request.query_params.get('year', today.year))
        
        start_date = today.replace(year=year, month=month, day=1)
        
        # Dernier jour du mois
        if month == 12:
            end_date = start_date.replace(year=year+1, month=1, day=1) - timedelta(days=1)
        else:
            end_date = start_date.replace(month=month+1, day=1) - timedelta(days=1)
        
        data = get_report_data(start_date, end_date)
        data['period_start'] = start_date
        data['period_end'] = end_date
        data['month'] = month
        data['year'] = year
        
        return Response(data)


class StatsView(APIView):
    """Statistiques générales"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()
        
        # Ventes du jour
        today_sales = Sale.objects.filter(created_at__date=today)
        today_revenue = today_sales.aggregate(Sum('total_ttc'))['total_ttc__sum'] or 0
        
        # Ventes de la semaine
        week_start = today - timedelta(days=today.weekday())
        week_sales = Sale.objects.filter(created_at__date__gte=week_start)
        week_revenue = week_sales.aggregate(Sum('total_ttc'))['total_ttc__sum'] or 0
        
        # Ventes du mois
        month_start = today.replace(day=1)
        month_sales = Sale.objects.filter(created_at__date__gte=month_start)
        month_revenue = month_sales.aggregate(Sum('total_ttc'))['total_ttc__sum'] or 0
        
        # Top produits
        top_products = SaleItem.objects.filter(
            sale__created_at__date__gte=month_start
        ).values(
            'product__name', 'product__barcode'
        ).annotate(
            total_qty=Sum('quantity'),
            total_revenue=Sum('total_price_ht')
        ).order_by('-total_qty')[:5]
        
        # Produits en stock bas
        low_stock = Product.objects.filter(
            stock__lte=F('min_stock'),
            active=True
        ).values('id', 'name', 'stock', 'min_stock')[:10]
        
        # Comparaison avec hier
        yesterday = today - timedelta(days=1)
        yesterday_revenue = Sale.objects.filter(
            created_at__date=yesterday
        ).aggregate(Sum('total_ttc'))['total_ttc__sum'] or Decimal('0')
        
        revenue_change = 0
        if yesterday_revenue > 0:
            revenue_change = ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100
        
        return Response({
            'today': {
                'sales_count': today_sales.count(),
                'revenue': float(today_revenue),
                'revenue_change': float(revenue_change)
            },
            'week': {
                'sales_count': week_sales.count(),
                'revenue': float(week_revenue)
            },
            'month': {
                'sales_count': month_sales.count(),
                'revenue': float(month_revenue)
            },
            'top_products': list(top_products),
            'low_stock': list(low_stock)
        })


class ReportSettingsView(generics.RetrieveUpdateAPIView):
    """Configuration des rapports automatiques"""
    serializer_class = ReportSettingsSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    
    def get_object(self):
        return ReportSettings.get_settings()


class ReportLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Historique des rapports envoyés"""
    queryset = ReportLog.objects.all()
    serializer_class = ReportLogSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        report_type = self.request.query_params.get('type')
        if report_type:
            queryset = queryset.filter(report_type=report_type)
        
        return queryset
    
    @action(detail=False, methods=['post'])
    def test_email(self, request):
        """Envoyer un rapport de test"""
        from .tasks import send_daily_report
        
        # Pour le test, on envoie un rapport journalier
        result = send_daily_report.delay()
        
        return Response({
            'message': 'Test report queued',
            'task_id': str(result.id)
        })
