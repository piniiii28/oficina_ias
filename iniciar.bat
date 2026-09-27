@echo off
REM Inicia la Oficina de IAs en Windows (doble clic).
REM Si se instaló con instalar.bat (git), busca actualizaciones al abrir.
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js 20 o superior: https://nodejs.org & pause & exit /b 1)
if exist .git (
  echo Buscando actualizaciones...
  set GIT_TERMINAL_PROMPT=0
  git pull --ff-only --quiet || echo No pude buscar actualizaciones; sigo con la version actual.
)
echo Preparando la oficina...
call npm install --no-audit --no-fund --loglevel=error
call npm run build
start "" http://localhost:4747
set OFICINA_LANZADOR=1
:inicio
node server/src/index.js
REM Codigo 75 = la oficina pidio reiniciarse (por ejemplo, despues de actualizarse).
if %errorlevel%==75 (echo Reiniciando la oficina... & goto inicio)
pause
