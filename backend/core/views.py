from rest_framework import generics, viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.contrib.auth import get_user_model

from .serializers import (
    UserSerializer, 
    UserCreateSerializer, 
    UserUpdateSerializer,
    ChangePasswordSerializer,
    AppSettingsSerializer,
    CustomTokenObtainPairSerializer
)
from .models import AppSettings
from .permissions import IsAdminRole, CanManageUsers
from rest_framework_simplejwt.views import TokenObtainPairView

User = get_user_model()


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class UserMeView(generics.RetrieveUpdateAPIView):
    """Vue pour l'utilisateur connecté"""
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_object(self):
        return self.request.user
    
    @action(detail=False, methods=['post'])
    def change_password(self, request):
        """Changer le mot de passe de l'utilisateur connecté"""
        serializer = ChangePasswordSerializer(data=request.data)
        if serializer.is_valid():
            user = request.user
            if not user.check_password(serializer.validated_data['old_password']):
                return Response(
                    {'old_password': 'Mot de passe incorrect.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            user.set_password(serializer.validated_data['new_password'])
            user.save()
            return Response({'message': 'Mot de passe modifié avec succès.'})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class UserViewSet(viewsets.ModelViewSet):
    """API pour la gestion des utilisateurs (Admin only)"""
    queryset = User.objects.all()
    permission_classes = [IsAuthenticated, CanManageUsers]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    # pagination_class configured in settings.py REST_FRAMEWORK
    
    def get_serializer_class(self):
        if self.action == 'create':
            return UserCreateSerializer
        if self.action in ['update', 'partial_update']:
            return UserUpdateSerializer
        return UserSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        role = self.request.query_params.get('role')
        if role:
            queryset = queryset.filter(role=role)
        return queryset.order_by('username')
    
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """Réinitialiser le mot de passe d'un utilisateur (Admin)"""
        user = self.get_object()
        new_password = request.data.get('new_password', 'password123')
        user.set_password(new_password)
        user.save()
        return Response({
            'message': f'Mot de passe réinitialisé pour {user.username}'
        })
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """Activer/Désactiver un utilisateur"""
        user = self.get_object()
        user.is_active = not user.is_active
        user.save()
        return Response({
            'message': f'Utilisateur {"activé" if user.is_active else "désactivé"}',
            'is_active': user.is_active
        })


class AppSettingsView(generics.RetrieveUpdateAPIView):
    """Vue pour les paramètres de l'application"""
    serializer_class = AppSettingsSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    
    def get_object(self):
        return AppSettings.get_settings()


class PublicSettingsView(generics.RetrieveAPIView):
    """Vue publique des paramètres (nom boutique, logo, devise)"""
    serializer_class = AppSettingsSerializer
    permission_classes = [IsAuthenticated]
    
    def get_object(self):
        return AppSettings.get_settings()
    
    def retrieve(self, request, *args, **kwargs):
        settings = self.get_object()
        # Retourner seulement les infos publiques
        data = {
            'store_name': settings.store_name,
            'currency': settings.currency,
            'currency_symbol': settings.currency_symbol,
            'logo_url': request.build_absolute_uri(settings.store_logo.url) if settings.store_logo else None
        }
        return Response(data)


from django.http import JsonResponse, HttpResponse
from datetime import datetime
from io import BytesIO

class DatabaseExportView(generics.GenericAPIView):
    """Export de la base de données pour backup en Excel"""
    permission_classes = [IsAuthenticated, IsAdminRole]
    
    def get(self, request):
        from inventory.models import Product, Category, Supplier
        from sales.models import Sale, SaleItem
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        
        # Get selection parameters (default to True if not specified)
        include_products = request.query_params.get('products', 'true').lower() == 'true'
        include_categories = request.query_params.get('categories', 'true').lower() == 'true'
        include_suppliers = request.query_params.get('suppliers', 'true').lower() == 'true'
        include_sales = request.query_params.get('sales', 'true').lower() == 'true'
        include_users = request.query_params.get('users', 'true').lower() == 'true'
        include_settings = request.query_params.get('settings', 'true').lower() == 'true'
        
        # Créer le workbook Excel
        wb = Workbook()
        
        # Styles
        header_font = Font(bold=True, color='FFFFFF')
        header_fill = PatternFill(start_color='4F46E5', end_color='4F46E5', fill_type='solid')
        thin_border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        def style_header(ws, headers):
            for col, header in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col, value=header)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(horizontal='center')
                cell.border = thin_border
                ws.column_dimensions[cell.column_letter].width = max(15, len(header) + 5)
        
        # Sheet: Produits
        if include_products:
            ws = wb.active
            ws.title = "Produits"
            headers = ['ID', 'Nom', 'Code-barres', 'Catégorie', 'Fournisseur', 'Prix Achat', 'Prix Vente', 'TVA %', 'Stock', 'Seuil', 'Unité', 'Actif']
            style_header(ws, headers)
            
            for row, prod in enumerate(Product.objects.all(), 2):
                ws.cell(row=row, column=1, value=prod.id)
                ws.cell(row=row, column=2, value=prod.name)
                ws.cell(row=row, column=3, value=prod.barcode)
                ws.cell(row=row, column=4, value=prod.category.name if prod.category else '')
                ws.cell(row=row, column=5, value=prod.supplier.name if prod.supplier else '')
                ws.cell(row=row, column=6, value=float(prod.purchase_price))
                ws.cell(row=row, column=7, value=float(prod.sale_price))
                ws.cell(row=row, column=8, value=float(prod.tva))
                ws.cell(row=row, column=9, value=prod.stock)
                ws.cell(row=row, column=10, value=prod.min_stock)
                ws.cell(row=row, column=11, value=prod.unit)
                ws.cell(row=row, column=12, value='Oui' if prod.is_active else 'Non')
        
        # Sheet: Catégories
        if include_categories:
            ws = wb.create_sheet("Catégories")
            headers = ['ID', 'Nom', 'Description']
            style_header(ws, headers)
            
            for row, cat in enumerate(Category.objects.all(), 2):
                ws.cell(row=row, column=1, value=cat.id)
                ws.cell(row=row, column=2, value=cat.name)
                ws.cell(row=row, column=3, value=getattr(cat, 'description', ''))
        
        # Sheet: Fournisseurs
        if include_suppliers:
            ws = wb.create_sheet("Fournisseurs")
            headers = ['ID', 'Nom', 'Contact', 'Email', 'Téléphone', 'Adresse', 'Notes']
            style_header(ws, headers)
            
            for row, sup in enumerate(Supplier.objects.all(), 2):
                ws.cell(row=row, column=1, value=sup.id)
                ws.cell(row=row, column=2, value=sup.name)
                ws.cell(row=row, column=3, value=sup.contact_name)
                ws.cell(row=row, column=4, value=sup.email)
                ws.cell(row=row, column=5, value=sup.phone)
                ws.cell(row=row, column=6, value=sup.address)
                ws.cell(row=row, column=7, value=sup.notes)
        
        # Sheet: Ventes
        if include_sales:
            ws = wb.create_sheet("Ventes")
            headers = ['ID Vente', 'Date', 'Total', 'Mode Paiement', 'Caissier', 'Produit', 'Quantité', 'Prix Unit.', 'Sous-total']
            style_header(ws, headers)
            
            row = 2
            for sale in Sale.objects.all().order_by('-created_at')[:1000]:
                for item in sale.items.all():
                    ws.cell(row=row, column=1, value=sale.id)
                    ws.cell(row=row, column=2, value=sale.created_at.strftime('%Y-%m-%d %H:%M'))
                    ws.cell(row=row, column=3, value=float(sale.total))
                    ws.cell(row=row, column=4, value=sale.payment_method)
                    ws.cell(row=row, column=5, value=sale.cashier.username if sale.cashier else '')
                    ws.cell(row=row, column=6, value=item.product.name if item.product else 'Produit supprimé')
                    ws.cell(row=row, column=7, value=item.quantity)
                    ws.cell(row=row, column=8, value=float(item.unit_price))
                    ws.cell(row=row, column=9, value=float(item.total))
                    row += 1
        
        # Sheet: Utilisateurs
        if include_users:
            ws = wb.create_sheet("Utilisateurs")
            headers = ['ID', 'Nom utilisateur', 'Email', 'Prénom', 'Nom', 'Rôle', 'Téléphone', 'Actif', 'Voir Stock', 'Gérer Stock']
            style_header(ws, headers)
            
            for row, user in enumerate(User.objects.all(), 2):
                ws.cell(row=row, column=1, value=user.id)
                ws.cell(row=row, column=2, value=user.username)
                ws.cell(row=row, column=3, value=user.email)
                ws.cell(row=row, column=4, value=user.first_name)
                ws.cell(row=row, column=5, value=user.last_name)
                ws.cell(row=row, column=6, value=user.role)
                ws.cell(row=row, column=7, value=user.phone)
                ws.cell(row=row, column=8, value='Oui' if user.is_active else 'Non')
                ws.cell(row=row, column=9, value='Oui' if user.can_view_stock else 'Non')
                ws.cell(row=row, column=10, value='Oui' if user.can_manage_stock else 'Non')
        
        # Sheet: Paramètres
        if include_settings:
            ws = wb.create_sheet("Paramètres")
            settings = AppSettings.get_settings()
            
            ws.cell(row=1, column=1, value="Paramètre").font = header_font
            ws.cell(row=1, column=1).fill = header_fill
            ws.cell(row=1, column=2, value="Valeur").font = header_font
            ws.cell(row=1, column=2).fill = header_fill
            ws.column_dimensions['A'].width = 25
            ws.column_dimensions['B'].width = 40
            
            params = [
                ('Nom de la boutique', settings.store_name),
                ('Adresse', settings.store_address),
                ('Téléphone', settings.store_phone),
                ('Email', settings.store_email),
                ('Devise', settings.currency),
                ('Symbole devise', settings.currency_symbol),
                ('TVA par défaut', f"{settings.default_tva}%"),
                ('Date export', datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
            ]
            
            for row, (param, value) in enumerate(params, 2):
                ws.cell(row=row, column=1, value=param)
                ws.cell(row=row, column=2, value=value)
        
        # Si pas de produits sélectionnés, supprimer la feuille par défaut vide
        if not include_products and 'Sheet' in wb.sheetnames:
            del wb['Sheet']
        
        # Créer la réponse HTTP avec le fichier Excel
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        
        filename = f"libtak_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        response = HttpResponse(
            output.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
