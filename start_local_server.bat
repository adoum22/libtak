@echo off
REM ============================================
REM Libtak Local Server - Auto-Start Script
REM ============================================
REM This script starts the Django server on port 8001
REM It runs automatically at Windows startup via Task Scheduler

title Libtak Local Server

cd /d "D:\Application Librairie\App\backend"

REM Activate virtual environment if exists
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Start the Django development server on port 8001
echo Starting Libtak Local Server on port 8001...
echo Press Ctrl+C to stop

python manage.py runserver 0.0.0.0:8001 --noreload

REM If server stops, wait before exiting
pause
