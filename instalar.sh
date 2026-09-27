#!/usr/bin/env bash
# Instalador de la Oficina de IAs para macOS / Linux: la descarga con git para
# que después se actualice sola y trae tus datos si esta carpeta tiene una oficina vieja.
set -e
REPO=https://github.com/piniiii28/oficina_ias.git
RAMA=claude/great-sagan-lebtcr
DESTINO="$HOME/OficinaIAs"
DATOS="$HOME/Documents/Oficina de IAs"
AQUI="$(cd "$(dirname "$0")" && pwd)"
command -v git >/dev/null || { echo "Instala git (https://git-scm.com) y vuelve a ejecutar este instalador."; exit 1; }
command -v node >/dev/null || { echo "Instala Node.js 20 o superior (https://nodejs.org) y vuelve a ejecutar este instalador."; exit 1; }
if [ -d "$DESTINO/.git" ]; then
  echo "Ya estaba instalada en $DESTINO. Actualizando..."
  git -C "$DESTINO" pull --ff-only
else
  echo "Descargando la oficina en $DESTINO ..."
  git clone -b "$RAMA" "$REPO" "$DESTINO"
fi
if [ -f "$AQUI/data/oficina.json" ] && [ ! -f "$DATOS/oficina.json" ]; then
  echo "Copiando tus datos a $DATOS ..."
  mkdir -p "$DATOS" && cp -R "$AQUI/data/." "$DATOS/"
fi
chmod +x "$DESTINO/iniciar.sh" "$DESTINO/nodo.sh" 2>/dev/null || true
echo "Listo. Desde ahora abre la oficina con: $DESTINO/iniciar.sh (se actualiza sola)."
exec "$DESTINO/iniciar.sh"
