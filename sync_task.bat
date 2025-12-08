@echo off
REM ============================================
REM Libtak Sync Task - Runs every 30 minutes
REM ============================================
REM This script syncs local data to the cloud server
REM Schedule this with Windows Task Scheduler

cd /d "D:\Application Librairie\App\backend"

REM Activate virtual environment if exists
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Run the sync service
python sync_service.py

exit /b %ERRORLEVEL%
