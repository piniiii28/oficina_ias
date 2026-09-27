@echo off
REM Abre este computador como NODO de la Oficina de IAs (por ejemplo, el de la
REM casa donde esta la impresora). La oficina principal le habla por Tailscale.
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesitas instalar Node.js 20 o superior: https://nodejs.org & pause & exit /b 1)
if exist .git (
  echo Buscando actualizaciones...
  set GIT_TERMINAL_PROMPT=0
  git pull --ff-only --quiet || echo No pude buscar actualizaciones; sigo con la version actual.
)
call npm install --no-audit --no-fund --loglevel=error -w server
start "" http://localhost:4748
node server/src/node.js
pause
