@echo off
REM ============================================
REM   LibTak - Script de Synchronisation
REM   Envoie les ventes locales vers le cloud
REM ============================================

setlocal
set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"
set "PYTHON_BIN=python"
if exist "%PROJECT_DIR%.venv\Scripts\python.exe" set "PYTHON_BIN=%PROJECT_DIR%.venv\Scripts\python.exe"
if exist "%BACKEND_DIR%\venv\Scripts\python.exe" set "PYTHON_BIN=%BACKEND_DIR%\venv\Scripts\python.exe"
cd /d "%BACKEND_DIR%"

echo.
echo ============================================
echo   LibTak - Synchronisation vers le cloud
echo   %date% %time%
echo ============================================
echo.

"%PYTHON_BIN%" sync_to_cloud.py --push
set "SYNC_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Synchronisation terminee.
echo.

REM Pause uniquement si execute manuellement (pas depuis le planificateur)
if "%1"=="" pause
exit /b %SYNC_EXIT_CODE%
