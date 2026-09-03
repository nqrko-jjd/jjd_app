@echo off
REM Lance l'API (port 4100) + le web bureau (port 3100) de JJD App.
cd /d "%~dp0"
echo Liberation des ports 3100 / 4100...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3100 .*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4100 .*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
echo.
echo   API    : http://localhost:4100
echo   Bureau : http://localhost:3100
echo.
call npm run dev
