from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from decimal import Decimal
from datetime import date, timedelta

from inventory.models import Product
from sales.models import Sale, SaleItem
from .models import ReportSettings, ReportLog
from .tasks import get_report_data

User = get_user_model()


class ReportSettingsTest(TestCase):
    """Tests pour ReportSettings (singleton)"""
    
    def test_singleton_pattern(self):
        """Test qu'il n'y a qu'une seule instance de ReportSettings"""
        settings1 = ReportSettings.get_settings()
        settings1.daily_enabled = True
        settings1.save()
        
        settings2 = ReportSettings.get_settings()
        self.assertEqual(settings1.pk, settings2.pk)
        self.assertEqual(settings1.pk, 1)
    
    def test_recipients_list(self):
        """Test parsing de la liste des destinataires"""
        settings = ReportSettings.get_settings()
        settings.email_recipients = 'test1@email.com, test2@email.com, test3@email.com'
        settings.save()
        
        recipients = settings.get_recipients_list()
        self.assertEqual(len(recipients), 3)
        self.assertIn('test1@email.com', recipients)


class ReportDataTest(TestCase):
    """Tests pour la génération des données de rapport"""
    
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='test123'
        )
        self.product = Product.objects.create(
            name='Test Product',
            barcode='1234567890123',
            sale_price_ht=Decimal('10.00'),
            purchase_price=Decimal('6.00'),
            tva=Decimal('20.00'),
            stock=100
        )
    
    def test_empty_report(self):
        """Test rapport sans ventes"""
        today = date.today()
        data = get_report_data(today, today)
        
        self.assertEqual(data['total_sales'], 0)
        self.assertEqual(data['total_revenue'], 0.0)
        self.assertEqual(data['total_profit'], 0.0)
        self.assertEqual(len(data['items_sold']), 0)
    
    def test_report_with_sales(self):
        """Test rapport avec ventes"""
        # Créer une vente
        sale = Sale.objects.create(
            user=self.user,
            total_ht=Decimal('20.00'),
            total_tva=Decimal('4.00'),
            total_ttc=Decimal('24.00'),
            payment_method='CASH'
        )
        SaleItem.objects.create(
            sale=sale,
            product=self.product,
            product_name=self.product.name,
            quantity=2,
            unit_price_ht=Decimal('10.00'),
            total_price_ht=Decimal('20.00'),
            tva_rate=Decimal('20.00')
        )
        
        today = date.today()
        data = get_report_data(today, today)
        
        self.assertEqual(data['total_sales'], 1)
        self.assertEqual(data['total_revenue'], 24.0)
        self.assertGreater(data['total_profit'], 0)
        self.assertEqual(len(data['items_sold']), 1)


class ReportLogTest(TestCase):
    """Tests pour l'historique des rapports"""
    
    def test_create_report_log(self):
        """Test création d'un log de rapport"""
        today = date.today()
        log = ReportLog.objects.create(
            report_type='DAILY',
            period_start=today,
            period_end=today,
            total_sales=10,
            total_revenue=Decimal('500.00'),
            total_profit=Decimal('150.00'),
            items_sold={'items': []},
            recipients='test@email.com',
            success=True
        )
        self.assertEqual(log.report_type, 'DAILY')
        self.assertTrue(log.success)


class ReportingAPITest(APITestCase):
    """Tests API pour les rapports"""
    
    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin',
            password='admin123',
            role='ADMIN'
        )
        response = self.client.post('/api/auth/login/', {
            'username': 'admin',
            'password': 'admin123'
        })
        self.token = response.data['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.token}')
    
    def test_daily_report(self):
        """Test endpoint rapport journalier"""
        response = self.client.get('/api/reporting/daily/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('total_sales', response.data)
    
    def test_weekly_report(self):
        """Test endpoint rapport hebdomadaire"""
        response = self.client.get('/api/reporting/weekly/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_monthly_report(self):
        """Test endpoint rapport mensuel"""
        response = self.client.get('/api/reporting/monthly/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_stats_endpoint(self):
        """Test endpoint statistiques"""
        response = self.client.get('/api/reporting/stats/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('today', response.data)
    
    def test_report_settings(self):
        """Test endpoint paramètres rapports"""
        response = self.client.get('/api/reporting/settings/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_update_report_settings(self):
        """Test mise à jour paramètres rapports"""
        data = {
            'daily_enabled': True,
            'weekly_enabled': False,
            'email_recipients': 'test@example.com'
        }
        response = self.client.patch('/api/reporting/settings/', data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_report_logs(self):
        """Test liste des logs de rapports"""
        response = self.client.get('/api/reporting/logs/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
