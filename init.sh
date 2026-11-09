#!/usr/bin/env bash
# init.sh — gemelo bash/CI de init.ps1 (CyLMetrics).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
echo "==> Working directory: $PWD"
echo "==> Node: $(node --version) | npm: $(npm --version)"
npm install
npm run lint
npm run typecheck
npm test
echo "==> Motor Python: --check-deps"
(python -m src.analysis --check-deps || echo "AVISO: Python/lectores no disponibles. Ver docs/ANALISIS.md") 
npm run check:contrast || echo "AVISO: contraste falló"
echo "Base rápida OK. Build: npm run build (pesado, separado)."
if [ "${RUN_START_COMMAND:-0}" = "1" ]; then exec npm run dev; fi
