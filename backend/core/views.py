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
    pagination_class = None
    
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


from django.http import JsonResponse
from django.core import serializers
from datetime import datetime
import json

class DatabaseExportView(generics.GenericAPIView):
    """Export de la base de données pour backup"""
    permission_classes = [IsAuthenticated, IsAdminRole]
    
    def get(self, request):
        from inventory.models import Product, Category, Supplier
        from sales.models import Sale, SaleItem
        
        # Collecter toutes les données
        data = {
            'export_date': datetime.now().isoformat(),
            'export_by': request.user.username,
            'users': [],
            'categories': [],
            'suppliers': [],
            'products': [],
            'sales': [],
            'settings': {}
        }
        
        # Users (sans les mots de passe)
        for user in User.objects.all():
            data['users'].append({
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'role': user.role,
                'phone': user.phone,
                'is_active': user.is_active,
                'can_view_stock': user.can_view_stock,
                'can_manage_stock': user.can_manage_stock,
            })
        
        # Categories
        for cat in Category.objects.all():
            data['categories'].append({
                'id': cat.id,
                'name': cat.name,
                'description': getattr(cat, 'description', ''),
            })
        
        # Suppliers
        for sup in Supplier.objects.all():
            data['suppliers'].append({
                'id': sup.id,
                'name': sup.name,
                'contact_name': sup.contact_name,
                'email': sup.email,
                'phone': sup.phone,
                'address': sup.address,
                'notes': sup.notes,
            })
        
        # Products
        for prod in Product.objects.all():
            data['products'].append({
                'id': prod.id,
                'name': prod.name,
                'barcode': prod.barcode,
                'description': prod.description,
                'category_id': prod.category_id,
                'supplier_id': prod.supplier_id,
                'purchase_price': str(prod.purchase_price),
                'sale_price': str(prod.sale_price),
                'tva': str(prod.tva),
                'stock': prod.stock,
                'min_stock': prod.min_stock,
                'unit': prod.unit,
                'is_active': prod.is_active,
            })
        
        # Sales
        for sale in Sale.objects.all().order_by('-created_at')[:1000]:  # Limiter à 1000 dernières ventes
            sale_data = {
                'id': sale.id,
                'total': str(sale.total),
                'payment_method': sale.payment_method,
                'created_at': sale.created_at.isoformat(),
                'cashier_id': sale.cashier_id,
                'items': []
            }
            for item in sale.items.all():
                sale_data['items'].append({
                    'product_id': item.product_id,
                    'product_name': item.product.name if item.product else 'Produit supprimé',
                    'quantity': item.quantity,
                    'unit_price': str(item.unit_price),
                    'total': str(item.total),
                })
            data['sales'].append(sale_data)
        
        # Settings
        settings = AppSettings.get_settings()
        data['settings'] = {
            'store_name': settings.store_name,
            'store_address': settings.store_address,
            'store_phone': settings.store_phone,
            'store_email': settings.store_email,
            'currency': settings.currency,
            'currency_symbol': settings.currency_symbol,
            'default_tva': str(settings.default_tva),
        }
        
        # Créer la réponse JSON avec headers de téléchargement
        response = JsonResponse(data, json_dumps_params={'indent': 2, 'ensure_ascii': False})
        filename = f"libtak_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
