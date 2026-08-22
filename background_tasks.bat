@echo off
setlocal EnableExtensions
set "BACKEND_DIR=%~dp0backend"
set "PYTHON_EXE=python"
if exist "%BACKEND_DIR%\.venv\Scripts\python.exe" set "PYTHON_EXE=%BACKEND_DIR%\.venv\Scripts\python.exe"
if exist "%BACKEND_DIR%\venv\Scripts\python.exe" set "PYTHON_EXE=%BACKEND_DIR%\venv\Scripts\python.exe"

cd /d "%BACKEND_DIR%"
:loop
"%PYTHON_EXE%" manage.py local_backup_sync >> "%~dp0background_tasks.log" 2>&1
timeout /t 1800 /nobreak >nul
goto loop
