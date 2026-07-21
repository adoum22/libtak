from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework.exceptions import AuthenticationFailed
from django.urls import reverse
from .models import AppSettings, AuditLog
from .image_validators import validate_image_upload

User = get_user_model()


def validate_user_password(password, user):
    """Run the complete Django password policy and expose DRF errors."""
    try:
        password_validation.validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(list(exc.messages)) from exc
    return password


class ReplacedFileCleanupMixin:
    """Delete superseded uploads after the surrounding DB transaction commits."""

    managed_file_fields = ()

    def update(self, instance, validated_data):
        old_files = {}
        for field_name in self.managed_file_fields:
            field_file = getattr(instance, field_name, None)
            if field_file and field_file.name:
                old_files[field_name] = (field_file.storage, field_file.name)

        updated_instance = super().update(instance, validated_data)
        for field_name, (storage, old_name) in old_files.items():
            new_file = getattr(updated_instance, field_name, None)
            new_name = new_file.name if new_file else ''
            if new_name != old_name:
                transaction.on_commit(
                    lambda storage=storage, name=old_name: storage.delete(name),
                    robust=True,
                )
        return updated_instance


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        username = attrs.get('username') or attrs.get('email')
        password = attrs.get('password')
        user = None

        if username and password:
            # Check if user exists check password
            user = User.objects.filter(username__iexact=username).first()
            if not user:
                # Try email if username not found
                user = User.objects.filter(email__iexact=username).first()

            # SimpleJWT authenticates against USERNAME_FIELD. Resolve a valid
            # e-mail address without changing the generic failure response.
            if user and username.casefold() == (user.email or '').casefold():
                attrs[User.USERNAME_FIELD] = user.get_username()

        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            try:
                AuditLog.log(
                    user=user,
                    action=AuditLog.ActionType.LOGIN,
                    model_name='User',
                    object_id=user.pk if user else None,
                    object_repr='Failed login attempt',
                    changes={'success': False},
                    request=self.context.get('request'),
                )
            except Exception:
                pass
            raise
        try:
            AuditLog.log(
                user=self.user,
                action=AuditLog.ActionType.LOGIN,
                model_name='User',
                object_id=self.user.id,
                object_repr=str(self.user),
                request=self.context.get('request'),
            )
        except Exception:
            pass
        return data


class UserSerializer(ReplacedFileCleanupMixin, serializers.ModelSerializer):
    managed_file_fields = ('avatar',)
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    is_admin_role = serializers.BooleanField(read_only=True)
    avatar_url = serializers.SerializerMethodField()
    effective_can_view_stock = serializers.BooleanField(read_only=True)
    effective_can_manage_stock = serializers.BooleanField(read_only=True)

    def validate_avatar(self, value):
        return validate_image_upload(value)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'is_admin_role',
            'can_view_stock', 'can_manage_stock',
            'effective_can_view_stock', 'effective_can_manage_stock',
            'phone', 'avatar', 'avatar_url',
            'is_active', 'date_joined', 'last_login'
        ]
        read_only_fields = ['date_joined', 'last_login']

    def get_avatar_url(self, obj) -> str | None:
        if obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None


class MeSerializer(UserSerializer):
    """Serializer for the current user's own profile.

    A user may edit personal profile fields, but role/security flags must
    remain controlled by admin-only endpoints.
    """

    can_view_stock = serializers.BooleanField(
        source='effective_can_view_stock',
        read_only=True,
    )
    can_manage_stock = serializers.BooleanField(
        source='effective_can_manage_stock',
        read_only=True,
    )

    class Meta(UserSerializer.Meta):
        read_only_fields = [
            'role', 'role_display', 'is_admin_role',
            'can_view_stock', 'can_manage_stock',
            'is_active', 'date_joined', 'last_login',
        ]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=12)
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password', 'password_confirm',
            'first_name', 'last_name', 'role', 'phone',
            'can_view_stock', 'can_manage_stock'
        ]

    def validate(self, attrs):
        password_confirm = attrs.pop('password_confirm')
        if attrs['password'] != password_confirm:
            raise serializers.ValidationError({
                'password_confirm': 'Les mots de passe ne correspondent pas.'
            })

        candidate = User(
            username=attrs.get('username', ''),
            email=attrs.get('email', ''),
            first_name=attrs.get('first_name', ''),
            last_name=attrs.get('last_name', ''),
        )
        try:
            validate_user_password(attrs['password'], candidate)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({'password': exc.detail}) from exc
        if attrs.get('can_manage_stock'):
            attrs['can_view_stock'] = True
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(ReplacedFileCleanupMixin, serializers.ModelSerializer):
    managed_file_fields = ('avatar',)
    class Meta:
        model = User
        fields = [
            'username', 'email', 'first_name', 'last_name',
            'role', 'phone', 'avatar', 'is_active',
            'can_view_stock', 'can_manage_stock'
        ]

    def validate_avatar(self, value):
        return validate_image_upload(value)

    def validate(self, attrs):
        can_manage = attrs.get(
            'can_manage_stock',
            self.instance.can_manage_stock if self.instance else False,
        )
        can_view = attrs.get(
            'can_view_stock',
            self.instance.can_view_stock if self.instance else False,
        )
        if can_manage and not can_view:
            attrs['can_view_stock'] = True
        return attrs




class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, min_length=12)
    new_password_confirm = serializers.CharField(required=True)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': 'Les mots de passe ne correspondent pas.'
            })
        try:
            validate_user_password(
                attrs['new_password'],
                self.context['request'].user,
            )
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({'new_password': exc.detail}) from exc
        return attrs


class ResetPasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(required=True, min_length=12)
    new_password_confirm = serializers.CharField(required=False)

    def validate(self, attrs):
        confirmation = attrs.get('new_password_confirm')
        if confirmation is not None and confirmation != attrs['new_password']:
            raise serializers.ValidationError({
                'new_password_confirm': 'Les mots de passe ne correspondent pas.'
            })
        try:
            validate_user_password(attrs['new_password'], self.context['user'])
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({'new_password': exc.detail}) from exc
        return attrs


class AppSettingsSerializer(ReplacedFileCleanupMixin, serializers.ModelSerializer):
    managed_file_fields = ('store_logo',)
    logo_url = serializers.SerializerMethodField()

    def validate_store_logo(self, value):
        return validate_image_upload(value)

    def validate(self, attrs):
        can_manage = attrs.get(
            'cashier_can_manage_stock',
            self.instance.cashier_can_manage_stock if self.instance else False,
        )
        can_view = attrs.get(
            'cashier_can_view_stock',
            self.instance.cashier_can_view_stock if self.instance else False,
        )
        if can_manage and not can_view:
            attrs['cashier_can_view_stock'] = True
        return attrs

    class Meta:
        model = AppSettings
        fields = [
            'store_name', 'store_address', 'store_phone', 'store_email',
            'store_logo', 'logo_url',
            'default_tva', 'currency', 'currency_symbol',
            'print_header', 'print_footer',
            'company_name', 'company_rc', 'company_ice', 'company_if',
            'company_patente', 'company_cnss',
            'invoice_prefix', 'invoice_footer',
            'cashier_can_view_stock', 'cashier_can_manage_stock',
            'updated_at'
        ]
        read_only_fields = ['updated_at']

    def get_logo_url(self, obj) -> str | None:
        if obj.store_logo:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(reverse('app_settings_logo'))
            return reverse('app_settings_logo')
        return None


class AuditLogSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    action_display = serializers.CharField(source='get_action_display', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'username', 'action', 'action_display',
            'model_name', 'object_id', 'object_repr',
            'changes', 'ip_address', 'timestamp',
        ]
