# =====================================================================
# WSGI configuration for PythonAnywhere
# Copy this content into:  /var/www/<USERNAME>_pythonanywhere_com_wsgi.py
# (replace <USERNAME> with your PythonAnywhere username)
# =====================================================================

import os
import sys

# ---- 1. Path to your project on PythonAnywhere ----------------------
# After `git clone`, your code lives at /home/<USERNAME>/libtak
USERNAME = os.environ.get('PYTHONANYWHERE_USERNAME') or os.environ.get('USER')
if not USERNAME:
    raise RuntimeError('Set PYTHONANYWHERE_USERNAME in the Web app environment.')
PROJECT_HOME = f'/home/{USERNAME}/libtak/backend'

if PROJECT_HOME not in sys.path:
    sys.path.insert(0, PROJECT_HOME)

# ---- 2. Environment variables (production) --------------------------
# Set these in the PythonAnywhere "Web" tab > "Environment variables"
# OR uncomment and hardcode here (less safe).
#
# os.environ['DEBUG'] = 'False'
# os.environ['SECRET_KEY'] = 'replace-with-50-char-random-string'
# os.environ['JWT_SIGNING_KEY'] = 'replace-with-a-different-50-char-random-string'
# os.environ['BACKUP_ENCRYPTION_KEY'] = 'urlsafe-base64-encoded-32-byte-key'
# os.environ['ALLOWED_HOSTS'] = f'{USERNAME}.pythonanywhere.com'
# os.environ['CORS_ALLOWED_ORIGINS'] = 'https://libtak.vercel.app'
# os.environ['CSRF_TRUSTED_ORIGINS'] = 'https://libtak.vercel.app'
# os.environ['DATABASE_URL'] = f'sqlite:////home/{USERNAME}/libtak/backend/db.sqlite3'
# os.environ['IS_CLOUD_SERVER'] = 'True'
# os.environ['EMAIL_HOST'] = 'smtp.gmail.com'
# os.environ['EMAIL_PORT'] = '587'
# os.environ['EMAIL_HOST_USER'] = 'your@gmail.com'
# os.environ['EMAIL_HOST_PASSWORD'] = 'gmail-app-password'
# os.environ['DEFAULT_FROM_EMAIL'] = 'Libtak <your@gmail.com>'
# os.environ['SYNC_TOKEN'] = 'long-random-token-shared-with-local-pos'

os.environ.setdefault('IS_CLOUD_SERVER', 'True')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# ---- 3. Activate virtualenv -----------------------------------------
# Created with:  mkvirtualenv --python=python3.11 libtak
activate_this = f'/home/{USERNAME}/.virtualenvs/libtak/bin/activate_this.py'
if os.path.exists(activate_this):
    with open(activate_this) as f:
        exec(f.read(), {'__file__': activate_this})

# ---- 4. Launch Django -----------------------------------------------
from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
