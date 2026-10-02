@echo off
echo Recherche du serveur sur le port 4531...
set FOUND=0
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4531 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    set FOUND=1
)
if "%FOUND%"=="1" (
    echo Application arretee.
) else (
    echo Aucune application en cours d'execution sur le port 4531.
)
pause
