#!/bin/bash
# Double-click to start the DocuVault server. Needs Node.js 22.13 or newer (https://nodejs.org).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js LTS from https://nodejs.org, then double-click this file again."; read -r -p "Press Enter to close."; exit 1; fi
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || { echo "Node.js is too old. Install the current LTS from https://nodejs.org"; read -r -p "Press Enter to close."; exit 1; }
(sleep 2; open "http://localhost:${PORT:-8080}" 2>/dev/null || xdg-open "http://localhost:${PORT:-8080}" >/dev/null 2>&1) &
exec node --no-warnings server/server.mjs
