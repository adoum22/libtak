@echo off
REM ============================================
REM   LibTak - Démarrer le serveur local
REM   Point de Vente Librairie
REM ============================================

title LibTak - Serveur Local

cd /d "%~dp0backend"

echo.
echo ============================================
echo   LibTak - Serveur Local
echo   Librairie Attaquaddoum
echo ============================================
echo.
echo Le serveur demarre...
echo Ouvrez votre navigateur sur: http://localhost:8000
echo.
echo Pour arreter le serveur, fermez cette fenetre.
echo ============================================
echo.

REM Creer des secrets propres a cette installation sans les afficher.
if not exist ".env" python -c "from pathlib import Path; import secrets; Path('.env').write_text('SECRET_KEY='+secrets.token_urlsafe(50)+'\nJWT_SIGNING_KEY='+secrets.token_urlsafe(50)+'\nDEBUG=True\nALLOWED_HOSTS=localhost,127.0.0.1\nCORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\nIS_CLOUD_SERVER=False\n', encoding='utf-8')"

REM Mettre le schema a jour et demander le premier administrateur si besoin.
python manage.py migrate --noinput
python manage.py shell -c "from core.models import User; raise SystemExit(0 if User.objects.filter(role='ADMIN', is_active=True).exclude(password='').exclude(password__startswith='!').exists() else 1)"
if errorlevel 1 python manage.py createsuperuser
python manage.py shell -c "from core.models import User; raise SystemExit(0 if User.objects.filter(role='ADMIN', is_active=True).exclude(password='').exclude(password__startswith='!').exists() else 1)"
if errorlevel 1 (
    echo Aucun administrateur utilisable. Demarrage annule.
    exit /b 1
)

REM Demarrer Django uniquement sur la machine locale.
python manage.py runserver 127.0.0.1:8000

pause
