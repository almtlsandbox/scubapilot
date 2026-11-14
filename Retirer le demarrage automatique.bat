@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js est introuvable. Installez Node.js depuis https://nodejs.org puis relancez.
    pause
    exit /b 1
)
node launcher.js --remove-startup
pause
