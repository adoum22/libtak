@echo off
REM ============================================
REM   LibTak - Démarrer le serveur local
REM   Point de Vente Librairie
REM ============================================

title LibTak - Serveur Local

cd /d "D:\Application Librairie\App\backend"

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

REM Demarrer le serveur Django
python manage.py runserver 0.0.0.0:8000

pause
