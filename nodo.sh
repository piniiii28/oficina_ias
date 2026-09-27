#!/usr/bin/env bash
# Abre este computador como NODO de la Oficina de IAs (por ejemplo, el de la
# casa donde está la impresora). La oficina principal le habla por Tailscale.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Necesitas Node.js 20 o superior: https://nodejs.org"; exit 1; }
if [ -d .git ]; then GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet || echo "No pude buscar actualizaciones."; fi
npm install --no-audit --no-fund --loglevel=error -w server
( sleep 2; (command -v open >/dev/null && open http://localhost:4748) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4748) || true ) &
exec node server/src/node.js
