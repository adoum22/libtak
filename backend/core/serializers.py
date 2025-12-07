from rest_framework import serializers
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.exceptions import AuthenticationFailed
from .models import AppSettings

User = get_user_model()


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        username = attrs.get('username') or attrs.get('email')
        password = attrs.get('password')

        if username and password:
            # Check if user exists check password
            user = User.objects.filter(username=username).first()
            if not user:
                # Try email if username not found
                user = User.objects.filter(email=username).first()
            
            if user:
                if user.check_password(password):
                    if not user.is_active:
                        raise AuthenticationFailed(
                            detail='Votre compte a été désactivé. Veuillez contacter l\'administrateur.',
                            code='user_inactive'
                        )
                # If password incorrect, let standard auth handle it (or return generic error)

        return super().validate(attrs)


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    is_admin_role = serializers.BooleanField(read_only=True)
    avatar_url = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'is_admin_role',
            'can_view_stock', 'can_manage_stock',
            'phone', 'avatar', 'avatar_url',
            'is_active', 'date_joined', 'last_login'
        ]
        read_only_fields = ['date_joined', 'last_login']
    
    def get_avatar_url(self, obj):
        if obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)
    password_confirm = serializers.CharField(write_only=True)
    
    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password', 'password_confirm',
            'first_name', 'last_name', 'role', 'phone',
            'can_view_stock', 'can_manage_stock'
        ]
    
    def validate(self, attrs):
        if attrs['password'] != attrs.pop('password_confirm'):
            raise serializers.ValidationError({
                'password_confirm': 'Les mots de passe ne correspondent pas.'
            })
        return attrs
    
    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            'email', 'first_name', 'last_name',
            'role', 'phone', 'avatar', 'is_active',
            'can_view_stock', 'can_manage_stock'
        ]




class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=6)
    new_password_confirm = serializers.CharField(required=True)
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': 'Les mots de passe ne correspondent pas.'
            })
        return attrs


class AppSettingsSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    
    class Meta:
        model = AppSettings
        fields = [
            'store_name', 'store_address', 'store_phone', 'store_email',
            'store_logo', 'logo_url',
            'default_tva', 'currency', 'currency_symbol',
            'print_header', 'print_footer',
            'cashier_can_view_stock', 'cashier_can_manage_stock',
            'updated_at'
        ]
        read_only_fields = ['updated_at']
    
    def get_logo_url(self, obj):
        if obj.store_logo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.store_logo.url)
            return obj.store_logo.url
        return None
