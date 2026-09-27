@echo off
REM Abre este computador como NODO de la Oficina de IAs (por ejemplo, el de la
REM casa donde esta la impresora, o uno con buena tarjeta de video para Ollama).
REM La primera vez instala lo que falte: Node.js, Git y Ollama. Despues descarga
REM los modelos que usan las IAs y se actualiza solo.
cd /d "%~dp0"
setlocal

where node >nul 2>nul || (
  echo Instalando Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul || (echo Instale Node.js. Cierra esta ventana y vuelve a abrir nodo.bat. & pause & exit /b 0)

where git >nul 2>nul || if exist .git (
  echo Instalando Git para las actualizaciones...
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
)

set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
where ollama >nul 2>nul || if not exist "%OLLAMA_EXE%" (
  echo Instalando Ollama, los modelos de IA que corren en este computador...
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
)
if exist "%OLLAMA_EXE%" set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Ollama"

if exist .git (
  echo Buscando actualizaciones...
  set GIT_TERMINAL_PROMPT=0
  git pull --ff-only --quiet || echo No pude buscar actualizaciones; sigo con la version actual.
)
call npm install --no-audit --no-fund --loglevel=error -w server
start "" http://localhost:4748
set OFICINA_LANZADOR=1
:inicio
node server/src/node.js
REM Codigo 75 = el nodo se actualizo y pidio reiniciarse.
if %errorlevel%==75 (echo Reiniciando el nodo... & call npm install --no-audit --no-fund --loglevel=error -w server & goto inicio)
pause
