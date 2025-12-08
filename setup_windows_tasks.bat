@echo off
REM ============================================
REM Libtak - Setup Windows Scheduled Tasks
REM ============================================
REM Run this script AS ADMINISTRATOR to create:
REM   1. Auto-start local server at boot
REM   2. Sync task every 30 minutes
REM ============================================

echo ============================================
echo Libtak - Configuration des taches planifiees
echo ============================================
echo.
echo Ce script va creer:
echo   1. Demarrage automatique du serveur local
echo   2. Synchronisation toutes les 30 minutes
echo.

REM Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERREUR: Ce script doit etre execute en tant qu'administrateur!
    echo Clic droit sur le fichier -^> Executer en tant qu'administrateur
    pause
    exit /b 1
)

echo [1/2] Creation de la tache "Libtak Local Server"...
schtasks /create /tn "Libtak Local Server" ^
    /tr "\"D:\Application Librairie\App\start_local_server.bat\"" ^
    /sc onstart ^
    /ru "%USERNAME%" ^
    /rl highest ^
    /f

if %errorLevel% equ 0 (
    echo      OK - Serveur demarre automatiquement au demarrage Windows
) else (
    echo      ERREUR - Impossible de creer la tache
)

echo.
echo [2/2] Creation de la tache "Libtak Sync"...
schtasks /create /tn "Libtak Sync" ^
    /tr "\"D:\Application Librairie\App\sync_task.bat\"" ^
    /sc minute /mo 30 ^
    /ru "%USERNAME%" ^
    /f

if %errorLevel% equ 0 (
    echo      OK - Synchronisation toutes les 30 minutes
) else (
    echo      ERREUR - Impossible de creer la tache
)

echo.
echo ============================================
echo Configuration terminee!
echo ============================================
echo.
echo Pour verifier: Panneau de configuration -^> Outils d'administration -^> Planificateur de taches
echo.
echo Voulez-vous demarrer le serveur local maintenant? (O/N)
set /p START_NOW=

if /i "%START_NOW%"=="O" (
    echo Demarrage du serveur local...
    start "" "D:\Application Librairie\App\start_local_server.bat"
)

pause
