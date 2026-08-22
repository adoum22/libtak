@echo off
REM ============================================
REM Libtak Sync Task - Runs every 30 minutes
REM ============================================
REM This script syncs local data to the cloud server
REM Schedule this with Windows Task Scheduler

cd /d "%~dp0backend"

REM Activate virtual environment if exists
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Daily backup + due reports + best-effort cloud sync
python manage.py local_backup_sync

exit /b %ERRORLEVEL%
