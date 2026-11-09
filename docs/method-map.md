# Method Map — CyLMetrics (fallo → capa → fix, L01)

| Síntoma en CyLMetrics | Capa | Fix (artefacto) |
|---|---|---|
| “Añade vista X” se interpreta de 3 formas | Especificación | Reescribe `user_visible_behavior` + E2E en `feature_list.json` antes de codificar |
| Usa pages/, olvida `'use client'`, inventa API Next | Contexto | AGENTS.md §2 + `node_modules/next/dist/docs/` + `src/lib` como única definición |
| `npm install` / Node 22-25 / `.env` / venv OneDrive | Entorno | `.\init.ps1`, `.nvmrc`/`engines`, venv fuera de OneDrive (`docs/ANALISIS.md`) |
| “Terminado” pero 503 en prod / 341 XLSX “no analizados” | Verificación | `outputFileTracingIncludes` + `--check-deps`/`--strict-deps` + E2E obligatoria |
| Cada sesión re-explora catálogo vs informe | Estado | `claude-progress.md` + `feature_list.json` (foto vs vivo, no mezclar) |
| Toca portal + motor + informe en 1 feature | Alcance | Una feature a la vez; granularidad = una sesión |
| Sin logs de qué informe/fecha se verificó | Observabilidad | `docs/quality-document.md` + `verification.json` con `generated_at` |
| Próxima sesión no arranca | Handoff | `session-handoff.md` + checklist + `init` verde |

Bucle: registra fallo con output → atribuye a 1 capa → corrige artefacto → re-ejecuta → anota en progress.
