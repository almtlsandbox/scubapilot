@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js est introuvable. Installez Node.js depuis https://nodejs.org puis relancez.
    pause
    exit /b 1
)
if not exist "node_modules\express" (
    echo Installation des composants de ScubaPilot, un instant...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo L'installation des composants a echoue. Verifiez votre connexion Internet, puis relancez.
        pause
        exit /b 1
    )
)
echo Installation du demarrage automatique de ScubaPilot...
node launcher.js --install-startup
if errorlevel 1 (
    pause
    exit /b 1
)
echo.
echo Demarrage de ScubaPilot...
node launcher.js
pause
