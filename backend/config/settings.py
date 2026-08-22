import os
import secrets
import sys
import ipaddress
from pathlib import Path
from datetime import timedelta
from urllib.parse import urlsplit

# Celery est optionnel (pas installé sur PA free tier). On garde le
# CELERY_BEAT_SCHEDULE en tant que documentation/fallback pour les
# environnements qui ont Celery, mais sur PA c'est le management
# command send_scheduled_reports lancé par cron qui exécute les
# rapports à 23h.
try:
    from celery.schedules import crontab
    HAS_CELERY = True
except ImportError:
    HAS_CELERY = False
    def crontab(*args, **kwargs):  # noqa: E306
        """Stub no-op pour ne pas crasher la déclaration de
        CELERY_BEAT_SCHEDULE quand celery n'est pas installé."""
        return None

TESTING = 'test' in sys.argv

# Commandes manage.py qui peuvent tourner sans SECRET_KEY réelle
# (les commandes admin lancées en console PA n'héritent pas des
# env vars définies dans le fichier WSGI). On accepte une SECRET_KEY
# éphémère UNIQUEMENT pour ces commandes utilitaires - le webapp web
# continue d'exiger une SECRET_KEY persistante pour servir les requêtes.
_MANAGEMENT_COMMANDS = {
    'migrate', 'makemigrations', 'showmigrations', 'sqlmigrate',
    'shell', 'createsuperuser', 'collectstatic', 'check',
    'send_scheduled_reports', 'init_users', 'dbshell', 'dumpdata',
    'loaddata', 'changepassword', 'backup_database', 'restore_backup',
    'verify_backup', 'local_backup_sync', 'spectacular',
    'reconcile_fifo',
}
RUNNING_MANAGEMENT_COMMAND = any(arg in _MANAGEMENT_COMMANDS for arg in sys.argv)

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path):
    """Load KEY=value lines from a private env file if it exists."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file(Path.home() / '.libtak_env')
_load_env_file(BASE_DIR / '.env')

DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 'yes')

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    if DEBUG or TESTING or RUNNING_MANAGEMENT_COMMAND:
        # Never use a repository-known signing key, even for local runs.
        SECRET_KEY = secrets.token_urlsafe(50)
    else:
        raise RuntimeError("SECRET_KEY environment variable is required in production")
elif (
    not DEBUG
    and not TESTING
    and not RUNNING_MANAGEMENT_COMMAND
    and (len(SECRET_KEY) < 50 or SECRET_KEY.startswith('django-insecure-'))
):
    raise RuntimeError('SECRET_KEY must be a strong, installation-specific value')

JWT_SIGNING_KEY = os.environ.get('JWT_SIGNING_KEY', SECRET_KEY)
if (
    not DEBUG
    and not TESTING
    and not RUNNING_MANAGEMENT_COMMAND
    and len(JWT_SIGNING_KEY) < 50
):
    raise RuntimeError('JWT_SIGNING_KEY must contain at least 50 characters')

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')
    if host.strip()
]

# DRF and audit logging must apply the same trusted-proxy boundary.  Zero is
# the safe default for local/direct deployments and prevents spoofed XFF
# headers from bypassing anonymous/login throttles.
AUDIT_TRUSTED_PROXY_COUNT = max(
    0, int(os.environ.get('AUDIT_TRUSTED_PROXY_COUNT', '0'))
)

# CSRF (needed when frontend is on a different domain, e.g. Vercel)
CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',') if o.strip()
]

# Application definition
_OPTIONAL_APPS = []

# Only add daphne for ASGI in production when Redis is available
if os.environ.get('REDIS_URL'):
    _OPTIONAL_APPS.append('daphne')

INSTALLED_APPS = _OPTIONAL_APPS + [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'drf_spectacular',
    'channels',
    'django_celery_beat',

    # Local
    'core',
    'inventory',
    'sales',
    'reporting',
    'accounting',
    'credit',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'core.middleware.RequestSizeLimitMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # Static files in production
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'core.middleware.ApiSecurityHeadersMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database
DATABASE_URL = os.environ.get('DATABASE_URL')
SQL_HOST = os.environ.get('SQL_HOST')


def _database_url_requires_ssl(database_url):
    """Return False for local SQLite URLs that cannot accept sslmode."""
    scheme = database_url.split(':', 1)[0].lower()
    return scheme != 'sqlite'


if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
            ssl_require=(
                not DEBUG
                and _database_url_requires_ssl(DATABASE_URL)
                and os.environ.get('DATABASE_SSL_REQUIRE', 'True').lower()
                in ('true', '1', 'yes')
            ),
        )
    }
elif SQL_HOST:
    DATABASES = {
        'default': {
            'ENGINE': os.environ.get(
                'SQL_ENGINE', 'django.db.backends.postgresql'
            ),
            'NAME': os.environ.get('SQL_DATABASE', 'bookstore_db'),
            'USER': os.environ.get('SQL_USER', 'bookstore_user'),
            'PASSWORD': os.environ.get('SQL_PASSWORD', ''),
            'HOST': SQL_HOST,
            'PORT': os.environ.get('SQL_PORT', '5432'),
            'CONN_MAX_AGE': 600,
            'CONN_HEALTH_CHECKS': True,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': Path(
                os.environ.get('SQLITE_PATH', BASE_DIR / 'db.sqlite3')
            ).expanduser(),
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 12}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'fr-fr'
TIME_ZONE = 'Africa/Casablanca'  # Morocco timezone
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = 'static/'
STATIC_ROOT = Path(
    os.environ.get('STATIC_ROOT', BASE_DIR / 'staticfiles')
).expanduser()
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = 'media/'
MEDIA_ROOT = Path(
    os.environ.get('MEDIA_ROOT', BASE_DIR / 'media')
).expanduser()

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'COERCE_DECIMAL_TO_STRING': False,
    'NUM_PROXIES': AUDIT_TRUSTED_PROXY_COUNT,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.ScopedRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.AnonRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
        'login_account': '5/min',
        'file_upload': '20/day',
        'user': '1000/hour',
        'anon': '100/hour',
    },
}

if TESTING:
    # Disable throttling during tests so the suite isn't gated by login rate-limits.
    REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []
    REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'] = {}

# JWT Settings
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'CHECK_REVOKE_TOKEN': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'SIGNING_KEY': JWT_SIGNING_KEY,
}

# CORS
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000',
    ).split(',')
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = os.environ.get(
    'CORS_ALLOW_CREDENTIALS', 'False'
).lower() in ('true', '1', 'yes')
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]
CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

# Redis / Channels / Celery
REDIS_URL = os.environ.get('REDIS_URL', '')
CACHE_URL = os.environ.get('CACHE_URL', REDIS_URL)

if CACHE_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': CACHE_URL,
            'KEY_PREFIX': 'libtak',
            'TIMEOUT': 300,
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'libtak-single-process',
        }
    }

# Use InMemory for development, Redis for production
if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer"
        },
    }

# Celery Configuration
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', REDIS_URL)
CELERY_ACCEPT_CONTENT = ['application/json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Celery Beat delegates due-date decisions to the database-driven scheduler.
CELERY_BEAT_SCHEDULE = {
    'scheduled-reports': {
        'task': 'reporting.tasks.run_scheduled_reports',
        'schedule': crontab(minute='*/10'),
    },
    'purge-expired-jwt-tokens': {
        'task': 'core.tasks.purge_expired_jwt_tokens',
        'schedule': crontab(hour=2, minute=15),
    },
}

# User Model
AUTH_USER_MODEL = 'core.User'

# Email Configuration
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_USE_SSL = os.environ.get('EMAIL_USE_SSL', 'False').lower() in (
    'true', '1', 'yes'
)
EMAIL_USE_TLS = (
    os.environ.get('EMAIL_USE_TLS', 'True').lower() in ('true', '1', 'yes')
    and not EMAIL_USE_SSL
)
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get(
    'DEFAULT_FROM_EMAIL',
    EMAIL_HOST_USER or 'Librairie Attaquaddoum <noreply@librairie-attaquaddoum.com>',
)
EMAIL_TIMEOUT = int(os.environ.get('EMAIL_TIMEOUT', 30))

# In production we often configure only EMAIL_HOST_USER/PASSWORD in WSGI.
# If credentials exist, use real SMTP automatically; otherwise keep console
# backend for local/dev so tests and offline runs do not try to send mail.
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND',
    (
        'django.core.mail.backends.smtp.EmailBackend'
        if EMAIL_HOST_USER and EMAIL_HOST_PASSWORD
        else 'django.core.mail.backends.console.EmailBackend'
    ),
)

# Spectacular (API Docs)
SPECTACULAR_SETTINGS = {
    'TITLE': 'Librairie Attaquaddoum API',
    'DESCRIPTION': 'API pour le système de gestion de la Librairie Attaquaddoum',
    'VERSION': '1.0.0',
    'ENUM_NAME_OVERRIDES': {
        'SalePaymentMethodEnum': 'sales.models.Sale.PaymentMethod',
        'ReturnStatusEnum': 'sales.models.Return.ReturnStatus',
        'CreditSaleStatusEnum': 'credit.models.CreditSale.Status',
        'DiscountTypeEnum': 'sales.models.Discount.DiscountType',
        'PurchaseOrderStatusEnum': 'inventory.models.PurchaseOrder.OrderStatus',
        'InventoryCountStatusEnum': 'inventory.models.InventoryCount.CountStatus',
    },
}

# ===== SYNC CONFIGURATION =====
# For local server: set CLOUD_API_URL to point to your cloud deployment
# For cloud server: set IS_CLOUD_SERVER=True
CLOUD_API_URL = os.environ.get('CLOUD_API_URL', '').strip()  # e.g., 'https://librairie-api.onrender.com/api'
SYNC_TOKEN = os.environ.get('SYNC_TOKEN', '').strip()  # Shared secret for sync authentication


def _cloud_api_url_uses_secure_transport(url):
    """Allow HTTPS, or plain HTTP only to an exact loopback host."""
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        # Accessing ``port`` also rejects malformed values such as ``:abc``.
        parsed.port
    except (TypeError, ValueError):
        return False
    if not hostname or parsed.username or parsed.password or parsed.fragment:
        return False
    if parsed.scheme.lower() == 'https':
        return True
    if parsed.scheme.lower() != 'http':
        return False
    if hostname.lower() == 'localhost':
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


if (
    CLOUD_API_URL
    and not DEBUG
    and not TESTING
    and not _cloud_api_url_uses_secure_transport(CLOUD_API_URL)
):
    raise RuntimeError(
        'CLOUD_API_URL must use HTTPS outside localhost/loopback addresses'
    )
# SYNC_TOKEN is only required when cloud sync is explicitly configured.
# PythonAnywhere currently runs as the main app with SQLite and no sync, so
# blocking startup on a missing token prevents migrations/reloads for no gain.
IS_CLOUD_SERVER = os.environ.get('IS_CLOUD_SERVER', 'False').lower() in (
    'true', '1', 'yes'
)
if (CLOUD_API_URL or IS_CLOUD_SERVER) and not SYNC_TOKEN and not DEBUG:
    raise RuntimeError(
        "SYNC_TOKEN is required when cloud synchronization is enabled"
    )
if (
    (CLOUD_API_URL or IS_CLOUD_SERVER)
    and not DEBUG
    and not TESTING
    and not RUNNING_MANAGEMENT_COMMAND
    and len(SYNC_TOKEN) < 32
):
    raise RuntimeError('SYNC_TOKEN must contain at least 32 characters')
ENABLE_API_DOCS = os.environ.get('ENABLE_API_DOCS', str(DEBUG)).lower() in (
    'true', '1', 'yes'
)
ENABLE_DJANGO_ADMIN = os.environ.get(
    'ENABLE_DJANGO_ADMIN', str(DEBUG)
).lower() in ('true', '1', 'yes')

# Bound ordinary multipart/form requests before application-level validation.
DATA_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get('DATA_UPLOAD_MAX_MEMORY_SIZE', 20 * 1024 * 1024)
)
FILE_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get('FILE_UPLOAD_MAX_MEMORY_SIZE', 5 * 1024 * 1024)
)
MAX_REQUEST_BODY_SIZE = int(
    os.environ.get('MAX_REQUEST_BODY_SIZE', 25 * 1024 * 1024)
)
MAX_SINGLE_FILE_UPLOAD_SIZE = int(
    os.environ.get('MAX_SINGLE_FILE_UPLOAD_SIZE', 20 * 1024 * 1024)
)
FILE_UPLOAD_HANDLERS = [
    'core.upload_handlers.UploadSizeGuard',
    'django.core.files.uploadhandler.MemoryFileUploadHandler',
    'django.core.files.uploadhandler.TemporaryFileUploadHandler',
]

# ===== SECURITY HEADERS (production only) =====
if not DEBUG and not TESTING:
    SECURE_SSL_REDIRECT = os.environ.get(
        'SECURE_SSL_REDIRECT', 'True'
    ).lower() in ('true', '1', 'yes')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    if os.environ.get('TRUST_PROXY_SSL_HEADER', 'False').lower() in (
        'true', '1', 'yes'
    ):
        SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_REFERRER_POLICY = 'same-origin'
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
    X_FRAME_OPTIONS = 'DENY'

