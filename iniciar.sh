#!/usr/bin/env bash
# Inicia la Oficina de IAs en macOS / Linux.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Necesitas Node.js 20 o superior: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
npm run build
( sleep 2; (command -v open >/dev/null && open http://localhost:4747) || (command -v xdg-open >/dev/null && xdg-open http://localhost:4747) || true ) &
npm run start -w server
