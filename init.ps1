# init.ps1 — arranque estándar CyLMetrics (Windows PowerShell 5.1)
# L06: inicializar antes de cada sesión. No apilar features sobre base rota.
$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ROOT

Write-Output "==> Working directory: $((Get-Location).Path)"
Write-Output "==> Node: $(node --version) | npm: $(npm --version)"
Write-Output "==> Syncing dependencies (Node >=22 <25 según package.json)"
npm install
if (-not $?) { throw "npm install falló" }

Write-Output "==> Lint"
npm run lint
if (-not $?) { throw "lint falló — corrige base primero" }

Write-Output "==> Typecheck"
npm run typecheck
if (-not $?) { throw "typecheck falló" }

Write-Output "==> Tests portal (Vitest)"
npm test
if (-not $?) { throw "vitest falló" }

Write-Output "==> Motor Python: --check-deps (no descarga 23 GB sin lectores)"
try {
  python -m src.analysis --check-deps
  if (-not $?) { Write-Output "AVISO: --check-deps con warnings (ver docs/ANALISIS.md). No lanzar análisis largo." }
} catch {
  Write-Output "AVISO: Python o lectores no disponibles ($($_.Exception.Message)). Portal sigue, análisis no. Ver docs/ANALISIS.md + requirements-analysis.txt"
}

Write-Output "==> Contraste WCAG AA"
npm run check:contrast
if (-not $?) { Write-Output "AVISO: contraste falló (revisar paleta claro/oscuro)" }

Write-Output ""
Write-Output "Base rápida OK. Build completo aparte (pesado): npm run build"
Write-Output "E2E visores: npm run check:xlsx / check:json / check:shp / check:geo / check:table / check:tabular"
Write-Output "Verificación publicada: npm run verify:broken --census (luego --sample N)"
if ($env:RUN_START_COMMAND -eq "1") { npm run dev }
else { Write-Output 'Set $env:RUN_START_COMMAND="1" para lanzar dev directamente.' }
