@echo off
REM ============================================
REM   LibTak - Script de Synchronisation
REM   Envoie les ventes locales vers le cloud
REM ============================================

cd /d "D:\Application Librairie\App\backend"

REM Activer l'environnement virtuel si necessaire
REM call venv\Scripts\activate

echo.
echo ============================================
echo   LibTak - Synchronisation vers le cloud
echo   %date% %time%
echo ============================================
echo.

python sync_to_cloud.py

echo.
echo Synchronisation terminee.
echo.

REM Pause uniquement si execute manuellement (pas depuis le planificateur)
if "%1"=="" pause
