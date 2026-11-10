# Registro de Progreso — CyLMetrics

## Estado Verificado Actual

- Raíz: `C:\Users\jacar\Desktop\Dev\CyLMetrics`
- Inicio estándar: `.\init.ps1` (Windows) / `./init.sh` (CI)
- Verificación estándar: `npm run lint && npm run typecheck && npm test` + `python -m pytest src/analysis/tests -q` + `npm run check:contrast`
- Últimos commits: `cf17ddd` base del harness + guard de comandos · `ea5b839` análisis incremental · `1896a8b` evidencia del deploy
- Features: `base-001`, `base-002` y `qa-003` en `passing`; siguiente prioridad `portal-001`
- Bloqueador actual: ninguno. Base rápida en verde (lint, typecheck, 556 tests, pytest 147)
- Informe publicado: `2026-11-10T02:38:31Z` · **análisis completo desde cero** · 854 datasets · 1.728 distribuciones · 979 ok / 694 error / 55 omitidas · 23,64 GB · nota media 91,0 · 1.263 fragmentos
- Último deploy: pendiente de push del informe completo (el anterior, del 9 de noviembre, quedó verificado)

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
  - Push `79f42ec..ea5b839` → deployment de Vercel `success` (10:53:43Z).
  - Producción: `/api/quality` devuelve `2026-11-09T10:47:32Z` y 1.728 distribuciones; portada y `/calidad` muestran 854 datasets / 1.728 archivos / 23,50 GB / 9 de noviembre de 2026; ficha nueva `1285687231042` y su CSV sirven el fragmento `d7002d681618aaa9`.
- Evidencia capturada: resumen del CLI (990 ok / 609 err / 129 skip, 23.503,4 MB, score 91,0) + validación del bundle.
- Commits: `cf17ddd` (harness + guard) y commit de datos de esta sesión.
- Riesgo conocido: los CSV de 512 MiB tardan ~35–38 min cada uno; el motor usa hilos y el GIL serializa el parseo. No es falta de RAM (8,6 GB de 31,7 GB).
- Mejor próximo paso: `portal-001` (smoke de `/catalogo` y ficha sin errores de consola) y `qa-001` (contraste + visores delicados); el análisis ya está publicado y verificado.

### Sesión 003 — análisis completo desde cero (2026-11-09/10)

- Fecha: 2026-11-09 12:22 → 2026-11-10 03:35
- Objetivo: repetir el análisis sin reutilizar el checkpoint, para detectar cambios de contenido que el incremental no ve.
- Completado:
  - Análisis completo de 1.728 distribuciones con checkpoint nuevo y 2 workers (62 archivos >100 MB, 20,4 GB solo en ellos).
  - Detectado y corregido un falso negativo masivo: 444 descargas fallaban con `SSLError` porque `opendata.jcyl.es` no envía la cadena intermedia y certifi no la valida. `curl`/Windows sí. Se reanalizaron los 580 fallos de red con `truststore` y se incorporó `truststore` al motor (`src/analysis/__init__.py`) y a `requirements-analysis.txt`.
  - Reconstruido el bundle conservando la atribución de los 5 datasets que comparten URL (`https://www.jcyl.es/sie`, `https://www.geoportal.itacyl.es/`), que antes se perdían.
  - Informe final: 854 datasets, 1.728 distribuciones, 979 ok / 694 error / 55 omitidas, 23,64 GB, nota media 91,0, 1.263 fragmentos, 0 faltantes / 0 sobrantes.
- Hallazgos del catálogo:
  - **SHP:** 168 devuelven HTTP 404 (incluidos 17 que en septiembre abrían). Los enlaces redirigen a ZIP que ya no existen; los incendios forestales sí descargan. Es deterioro real del catálogo, no del motor.
  - **RPT personal laboral** (`1284893931079`): el CSV/JSON/XLSX pasó de 13.126 a 13.125 filas; el informe completo ya lo refleja.
  - `dct:modified` solo existe en 75/854 datasets; `dct:created` en 0; no hay fechas, tamaño ni checksum por distribución. Sin análisis completo periódico no se pueden detectar cambios de contenido con la misma URL.
- Verificación:
  - `npm run lint` y `npm run typecheck` verdes · `npm test` 556/556 · `pytest src/analysis/tests -q` 147 passed · `npm run build` exit 0.
  - Bundle: `generated_at=2026-11-10T02:38:31Z`, `source.url` real del catálogo, multiset catálogo↔informe exacto.
- Riesgo conocido: el GIL serializa el parseo; el análisis completo tardó ~15 h. Los CSV/XLSX con cientos de miles de filas son el cuello.
- Mejor próximo paso: push, deploy de Vercel y smoke de la web con el informe completo.
