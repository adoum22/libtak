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
