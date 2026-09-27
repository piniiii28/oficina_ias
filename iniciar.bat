@echo off
REM Inicia la Oficina de IAs en Windows (doble clic).
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js 20 o superior: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Instalando dependencias, solo la primera vez... & call npm install)
call npm run build
start "" http://localhost:4747
call npm run start -w server
pause
