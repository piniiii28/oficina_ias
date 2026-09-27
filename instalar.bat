@echo off
REM Instalador de la Oficina de IAs para Windows.
REM La descarga con git para que despues se actualice sola, trae tus datos
REM (si esta carpeta tiene una oficina vieja) y crea un acceso directo.
setlocal
set REPO=https://github.com/piniiii28/oficina_ias.git
set RAMA=claude/great-sagan-lebtcr
set DESTINO=%USERPROFILE%\OficinaIAs
set DATOS=%USERPROFILE%\Documents\Oficina de IAs

where git >nul 2>nul || (
  echo Instalando Git...
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  echo Listo. Cierra esta ventana y vuelve a abrir instalar.bat.
  pause & exit /b 0
)
where node >nul 2>nul || (
  echo Instalando Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo Listo. Cierra esta ventana y vuelve a abrir instalar.bat.
  pause & exit /b 0
)

if exist "%DESTINO%\.git" (
  echo La oficina ya estaba instalada en %DESTINO%. Actualizando...
  cd /d "%DESTINO%"
  git fetch origin %RAMA%
  git checkout %RAMA% || git checkout -b %RAMA% origin/%RAMA%
  git pull --ff-only origin %RAMA%
) else (
  echo Descargando la oficina en %DESTINO% ...
  echo Si GitHub te pide iniciar sesion, hazlo: queda guardado para las actualizaciones.
  git clone -b %RAMA% %REPO% "%DESTINO%" || (echo No se pudo descargar. & pause & exit /b 1)
)

REM Trae los datos de una oficina vieja (descargada en ZIP) si todavia no estan en Documentos.
if exist "%~dp0data\oficina.json" if not exist "%DATOS%\oficina.json" (
  echo Copiando tus datos a %DATOS% ...
  robocopy "%~dp0data" "%DATOS%" /E /NFL /NDL /NJH /NJS >nul
)

echo Creando el acceso directo en el escritorio...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Oficina de IAs.lnk');$s.TargetPath='%DESTINO%\iniciar.bat';$s.WorkingDirectory='%DESTINO%';$s.Save()"

echo.
echo Listo. Desde ahora abre la oficina con el acceso directo "Oficina de IAs" del escritorio.
echo Se actualiza sola cada vez que la abres.
call "%DESTINO%\iniciar.bat"
