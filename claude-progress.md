# Registro de Progreso — CyLMetrics

## Estado Verificado Actual

- Raíz: `C:\Users\jacar\Desktop\Dev\CyLMetrics`
- Inicio estándar: `.\init.ps1` (Windows) / `./init.sh` (CI)
- Verificación estándar: `npm run lint && npm run typecheck && npm test` + `python -m pytest src/analysis/tests -q` + `npm run check:contrast`
- Últimos commits: `cf17ddd` base del harness + guard de comandos · `79f42ec` sanear HTML + 4 conjuntos pendientes
- Features: `base-001` y `base-002` en `passing`; siguiente prioridad `portal-001`
- Bloqueador actual: ninguno. Base rápida en verde (lint, typecheck, 556 tests, pytest 147)
- Informe publicado: `2026-11-09T10:47:32Z` · 854 datasets · 1.728 distribuciones · 990 ok / 609 error / 129 omitidas · 23,5 GB · nota media 91,0 · 1.258 fragmentos

## Registro de Sesiones

### Sesión 001 — Aplicación del harness (2026-10-10)

- Objetivo: Aplicar template Learn Harness Engineering adaptado a stack dual
- Completado: AGENTS.md extendido (banner Next preservado), feature_list.json (6 features), init.ps1/init.sh duales, docs de harness, rúbrica y quality-doc. Primera ejecución real del harness.
- Verificación ejecutada: npm install OK (516 pkgs) · npx eslint exit 0 · npx tsc --noEmit exit 0 · npm test 555 passed + 1 failed (documented-commands, 53s)
- Evidencia capturada: outputs arriba + feature_list.json base-001 evidence[]
- Commits: (pendiente)
- Archivos actualizados: AGENTS.md, feature_list.json, init.ps1, init.sh, claude-progress.md, session-handoff.md, clean-state-checklist.md, evaluator-rubric.md, docs/method-map.md, docs/coding-agent-startup-flow.md, docs/quality-document.md
- Riesgo conocido: `npm run build` es pesado (catálogo estático completo); no bloquear sesiones rápidas por él salvo cambio de rutas/informe
- Mejor próximo paso: ejecutar `.\init.ps1`, marcar `base-001` → `passing` con evidencia, luego `base-002` (pytest 47 tests)

### Sesión 002 — análisis de noviembre y despliegue (2026-11-09)

- Fecha: 2026-11-09
- Objetivo: sincronizar con GitHub, analizar el catálogo y los datasets, publicar el informe y verificar el deploy de Vercel
- Completado:
  - Guard `documented-commands` corregido: `--incremental` documentado con `--output` explícito (prueba y publicación).
  - Plan incremental: catálogo 1.728 distribuciones (antes 1.695); 20 datasets nuevos, 20 modificados, 814 sin cambios; 102 distribuciones reanalizadas.
  - Análisis ejecutado con checkpoint y bundle en `%TEMP%\jcyl-analysis` (fuera de la carpeta del repo).
  - Bundle verificado: 854 datasets, 1.728 distribuciones, 1.258 fragmentos, 0 faltantes / 0 sobrantes.
  - Publicado en `reports/current/` (`index.json` + `d/*.json`); checkpoint local actualizado.
- Verificación ejecutada:
  - `npm run lint` exit 0 · `npm run typecheck` exit 0 · `npm test` 556/556.
  - `python -m src.analysis --check-deps` OK · `pytest src/analysis/tests -q` 147 passed.
  - Comprobación de coherencia del bundle (ids de fragmento vs índice) OK.
  - `npm run build` exit 0: 848 rutas de catálogo + 1.720 de distribución prerenderizadas.
- Evidencia capturada: resumen del CLI (990 ok / 609 err / 129 skip, 23.503,4 MB, score 91,0) + validación del bundle.
- Commits: `cf17ddd` (harness + guard) y commit de datos de esta sesión.
- Riesgo conocido: los CSV de 512 MiB tardan ~35–38 min cada uno; el motor usa hilos y el GIL serializa el parseo. No es falta de RAM (8,6 GB de 31,7 GB).
- Mejor próximo paso: push a GitHub y comprobar el deployment de Vercel + `/api/quality` publicado.
