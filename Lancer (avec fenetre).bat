@echo off
cd /d "%~dp0"
echo Demarrage de l'application...
start "" http://localhost:4531
node server.js
pause
