#!/usr/bin/env bash
# Abre este computador como NODO de la Oficina de IAs (por ejemplo, el de la
# casa donde está la impresora, o uno con buena tarjeta de video para Ollama).
# La primera vez instala Ollama si falta; después descarga los modelos que
# usan las IAs y se actualiza solo.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Necesitas Node.js 20 o superior: https://nodejs.org"; exit 1; }
if ! command -v ollama >/dev/null && [ ! -x /Applications/Ollama.app/Contents/Resources/ollama ]; then
  echo "Instalando Ollama…"
  if [ "$(uname)" = "Darwin" ]; then
    if command -v brew >/dev/null; then brew install ollama; else echo "Descarga Ollama desde https://ollama.com/download y vuelve a abrir nodo.sh"; fi
  else
    curl -fsSL https://ollama.com/install.sh | sh || echo "No pude instalar Ollama; instálalo desde https://ollama.com/download"
  fi
fi
if [ -d .git ]; then GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet || echo "No pude buscar actualizaciones."; fi
npm install --no-audit --no-fund --loglevel=error -w server
( sleep 2; (command -v open >/dev/null && open http://localhost:4748) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4748) || true ) &
export OFICINA_LANZADOR=1
while true; do
  node server/src/node.js
  code=$?
  # Código 75 = el nodo se actualizó y pidió reiniciarse.
  [ "$code" = "75" ] || break
  echo "Reiniciando el nodo…"
  npm install --no-audit --no-fund --loglevel=error -w server
done
