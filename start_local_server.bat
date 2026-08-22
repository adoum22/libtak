@echo off
setlocal EnableExtensions
title LibTak - Point de vente

set "APP_DIR=%~dp0"
set "BACKEND_DIR=%APP_DIR%backend"
set "FRONTEND_DIR=%APP_DIR%frontend"

if exist "%BACKEND_DIR%\.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
) else if exist "%BACKEND_DIR%\venv\Scripts\python.exe" (
    set "PYTHON_EXE=%BACKEND_DIR%\venv\Scripts\python.exe"
) else (
    set "PYTHON_EXE=python"
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Node.js/npm est introuvable. Installez Node.js LTS puis relancez.
    pause
    exit /b 1
)

cd /d "%BACKEND_DIR%"
"%PYTHON_EXE%" ensure_local_env.py ".env"
if errorlevel 1 goto :failure

"%PYTHON_EXE%" manage.py migrate --noinput
if errorlevel 1 goto :failure
"%PYTHON_EXE%" manage.py check
if errorlevel 1 goto :failure

"%PYTHON_EXE%" manage.py shell -c "from core.models import User; raise SystemExit(0 if User.objects.filter(role='ADMIN', is_active=True).exclude(password='').exclude(password__startswith='!').exists() else 1)"
if errorlevel 1 (
    "%PYTHON_EXE%" manage.py createsuperuser
    if errorlevel 1 goto :failure
)

if not exist "%FRONTEND_DIR%\node_modules" (
    cd /d "%FRONTEND_DIR%"
    call npm.cmd ci
    if errorlevel 1 goto :failure
)
if not exist "%FRONTEND_DIR%\dist\index.html" (
    cd /d "%FRONTEND_DIR%"
    set "VITE_API_URL=http://127.0.0.1:8000/api"
    call npm.cmd run build
    if errorlevel 1 goto :failure
)

start "LibTak API" /D "%BACKEND_DIR%" "%PYTHON_EXE%" -m daphne -b 127.0.0.1 -p 8000 config.asgi:application
start "LibTak Application" /D "%FRONTEND_DIR%" cmd /k npm.cmd run preview -- --host 127.0.0.1 --port 5173 --strictPort
start "LibTak Background" /min "%APP_DIR%background_tasks.bat"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo LibTak est lance. Fermez les fenetres LibTak pour arreter l'application.
exit /b 0

:failure
echo.
echo ERREUR: le demarrage de LibTak a echoue. Consultez les messages ci-dessus.
pause
exit /b 1
