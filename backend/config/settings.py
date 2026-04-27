import os
import sys
from pathlib import Path
from datetime import timedelta

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
# bidon UNIQUEMENT pour ces commandes utilitaires - le webapp web
# continue d'exiger la vraie SECRET_KEY pour servir les requêtes.
_MANAGEMENT_COMMANDS = {
    'migrate', 'makemigrations', 'showmigrations', 'sqlmigrate',
    'shell', 'createsuperuser', 'collectstatic', 'check',
    'send_scheduled_reports', 'init_users', 'dbshell', 'dumpdata',
    'loaddata', 'changepassword',
}
RUNNING_MANAGEMENT_COMMAND = any(arg in _MANAGEMENT_COMMANDS for arg in sys.argv)

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get('DEBUG', 'False').lower() in ('true', '1', 'yes')

SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    if DEBUG or TESTING or RUNNING_MANAGEMENT_COMMAND:
        SECRET_KEY = 'django-insecure-dev-only-not-for-production'
    else:
        raise RuntimeError("SECRET_KEY environment variable is required in production")

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

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
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # Static files in production
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
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

if DATABASE_URL:
    import dj_database_url

    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
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
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'COERCE_DECIMAL_TO_STRING': False,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.ScopedRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.AnonRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
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
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=2),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

# CORS
CORS_ALLOWED_ORIGINS = os.environ.get('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000').split(',')
CORS_ALLOW_CREDENTIALS = True
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

# Celery Beat Schedule - Rapports automatiques
CELERY_BEAT_SCHEDULE = {
    'daily-report': {
        'task': 'reporting.tasks.send_daily_report',
        'schedule': crontab(hour=23, minute=0),  # Tous les jours à 23h00
    },
    'weekly-report': {
        'task': 'reporting.tasks.send_weekly_report',
        'schedule': crontab(hour=23, minute=30, day_of_week=0),  # Dimanche à 23h30
    },
    'monthly-report': {
        'task': 'reporting.tasks.send_monthly_report',
        'schedule': crontab(hour=23, minute=45, day_of_month=28),  # 28 du mois
    },
    'quarterly-report': {
        'task': 'reporting.tasks.send_quarterly_report',
        'schedule': crontab(hour=23, minute=50, day_of_month=28, month_of_year='3,6,9,12'),
    },
    'yearly-report': {
        'task': 'reporting.tasks.send_yearly_report',
        'schedule': crontab(hour=23, minute=55, month_of_year=12, day_of_month=31),
    },
    'low-stock-alert': {
        'task': 'reporting.tasks.send_low_stock_alert',
        'schedule': crontab(hour=9, minute=0),  # Tous les jours à 9h
    },
    'daily-backup': {
        'task': 'reporting.tasks.daily_database_backup',
        'schedule': crontab(hour=18, minute=0),  # Tous les jours à 18h
    },
}

# User Model
AUTH_USER_MODEL = 'core.User'

# Email Configuration (à configurer avec vos propres credentials)
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND', 
    'django.core.mail.backends.console.EmailBackend'  # Par défaut: console pour dev
)
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'Librairie Attaquaddoum <noreply@librairie-attaquaddoum.com>')

# Spectacular (API Docs)
SPECTACULAR_SETTINGS = {
    'TITLE': 'Librairie Attaquaddoum API',
    'DESCRIPTION': 'API pour le système de gestion de la Librairie Attaquaddoum',
    'VERSION': '1.0.0',
}

# ===== SYNC CONFIGURATION =====
# For local server: set CLOUD_API_URL to point to your cloud deployment
# For cloud server: set IS_CLOUD_SERVER=True
CLOUD_API_URL = os.environ.get('CLOUD_API_URL', '')  # e.g., 'https://librairie-api.onrender.com/api'
SYNC_TOKEN = os.environ.get('SYNC_TOKEN')  # Shared secret for sync authentication
# SYNC_TOKEN is only required when cloud sync is explicitly configured.
# PythonAnywhere currently runs as the main app with SQLite and no sync, so
# blocking startup on a missing token prevents migrations/reloads for no gain.
if CLOUD_API_URL and not SYNC_TOKEN and not DEBUG:
    raise RuntimeError("SYNC_TOKEN environment variable is required when CLOUD_API_URL is configured")
IS_CLOUD_SERVER = os.environ.get('IS_CLOUD_SERVER', 'True') == 'True'  # Default True for PythonAnywhere

# ===== SECURITY HEADERS (production only) =====
if not DEBUG and not TESTING:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_REFERRER_POLICY = 'same-origin'
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'

