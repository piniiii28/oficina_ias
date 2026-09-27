#!/usr/bin/env bash
# Inicia la Oficina de IAs en macOS / Linux.
# Si se instaló con instalar.sh (git), busca actualizaciones al abrir.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Necesitas Node.js 20 o superior: https://nodejs.org"; exit 1; }
if [ -d .git ]; then
  echo "Buscando actualizaciones..."
  GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet || echo "No pude buscar actualizaciones; sigo con la versión actual."
fi
echo "Preparando la oficina..."
npm install --no-audit --no-fund --loglevel=error
npm run build || exit 1
( sleep 2; (command -v open >/dev/null && open http://localhost:4747) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4747) || true ) &
export OFICINA_LANZADOR=1
while true; do
  node server/src/index.js
  # Código 75 = la oficina pidió reiniciarse (por ejemplo, después de actualizarse).
  [ $? -eq 75 ] || break
  echo "Reiniciando la oficina..."
done
