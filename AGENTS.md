<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CyLMetrics — Harness (Next.js 16 + Python 3.12 + opencode)

> Síntesis de Learn Harness Engineering (L01–L12). Router corto: el detalle vive en `docs/DESARROLLO.md`, `docs/ANALISIS.md` y `docs/quality-document.md`. No dupliques versiones ni comandos aquí: `package.json` es la única fuente del stack JS (ver `docs/DESARROLLO.md`).

Objetivo: dejar el repo para que la próxima sesión continúe sin adivinar. El portal enseña una foto fechada (`reports/current/` versionado); el catálogo se lee en vivo. No confundir ambos (ver `docs/DESARROLLO.md` Decisiones).

## 1. Inicio obligatorio (L06)

1. `Get-Location` → confirma raíz `CyLMetrics`.
2. Lee `claude-progress.md` → estado verificado + próxima feature.
3. Lee `feature_list.json` → elige UNA `not_started` de mayor prioridad. Solo una en `in_progress`.
4. `git log --oneline -5` + `git status`.
5. Ejecuta `.\init.ps1` (Windows) o `./init.sh` (bash/CI). Si la base falla, corrígela primero. No apiles features sobre base rota.
6. Para trabajo Python: `python -m src.analysis --check-deps` antes de cualquier análisis largo (los informes sin `openpyxl` archivaron 341 XLSX como «no analizados» — ver `docs/ANALISIS.md`).

## 2. Dónde está la verdad (L03)

- JS/portal: `package.json` (Node >=22 <25, Next 16.3, React 19), `docs/DESARROLLO.md`, `src/lib/` (una sola definición por pregunta: `quality.ts`, `availability.ts`, `metadata-gaps.ts`, `rdf-catalog.ts`, `proxy-allow.ts`).
- Python/motor: `requirements-analysis.txt` (Python >=3.12, billion-laughs), `docs/ANALISIS.md`, `src/analysis/`.
- Despliegue: `reports/current/` se versiona; `next.config.ts outputFileTracingIncludes` debe incluir rutas del informe o `/api/quality` da 503 solo en prod.
- Si dudas de APIs Next por memoria (training desfasado), lee `node_modules/next/dist/docs/` como indica el banner superior.

## 3. Reglas opencode

- Una feature a la vez (L07). Fuera de alcance solo fix de soporte estrecho y documentado.
- `todowrite` en tareas 3+ pasos; `read` antes de `edit`; diff mínimo; `grep`/`glob` para buscar.
- `npx` only. No commitear `.env*`, ni `analysis.checkpoint.jsonl` (~100 MB, en `.gitignore`), ni bundles `--legacy-output` (~164 MB > límite GitHub).
- OneDrive: venv y checkpoint/output en disco local (`%LOCALAPPDATA%\venvs\cylmetrics`, `%TEMP%\jcyl-analysis`). Ver avisos en `docs/ANALISIS.md`.
- Documentación no contradice al código: hay tests `pipeline-limits`, `content-scoring`, `documented-commands` que lo verifican. Si cambias topes/fórmulas/comandos, actualiza tests + docs a la vez.

## 4. Verificación (mayor ROI, L09–L10)

```
npm run lint && npm run typecheck && npm test          # portal (Vitest)
python -m pytest src/analysis/tests -q                 # motor (147 tests)
npm run check:contrast                                 # paleta WCAG AA claro+oscuro
npm run build                                          # estático completo (puede tardar)
E2E piezas delicadas: check:xlsx, check:json, check:shp, check:geo, check:table, check:tabular
verify:broken [--census|--sample N|--all]              # evidencia en reports/current/verification.json
Full: .\init.ps1  (lanza todo lo rápido; build separado si es pesado)
```

- Unit ≠ verificación real. `passing` exige E2E/smoke ejecutado con evidencia (L10).
- No cambies comandos de verificación en silencio durante la feature.
- `reports:seed --dry-run` antes de re-analizar; `--incremental` para catálogo crecido.

## 5. Feature list es primitiva (L08)

- `feature_list.json` = única fuente de qué falta. Triple `(comportamiento visible, verificación, estado)`.
- Estados: `not_started` | `in_progress` (una) | `blocked` (motivo en notes) | `passing` (verificación + `evidence[]` con commit + output).
- Prohibido `passing` sin evidencia.

## 6. Definition of Done

- [ ] comportamiento visible implementado
- [ ] `lint + typecheck + vitest` verdes (+ `pytest` si tocó `src/analysis`)
- [ ] verificación E2E/smoke de la feature ejecutada de verdad
- [ ] evidencia en `feature_list.json` + `claude-progress.md`
- [ ] `.\init.ps1` sigue verde; `reports/current/` intacto o actualizado a propósito
- [ ] sin secretos ni blobs >50 MB en el commit

## 7. Fin de sesión (L12)

1. Actualiza `claude-progress.md` + `feature_list.json` (estados reales).
2. Actualiza `session-handoff.md` si sesión larga.
3. Pasa `clean-state-checklist.md`.
4. Commit descriptivo (`fix(scope):`, `feat(scope):`). `git status` limpio o documentado.

## 8. Si falla → harness primero (L01)

`especificación | contexto | entorno | verificación | estado` → `docs/method-map.md`. Aplica bucle: registra → atribuye a 1 capa → corrige artefacto → re-ejecuta → anota.

Detalle: `docs/coding-agent-startup-flow.md` · Calidad: `docs/quality-document.md` · Rúbrica: `evaluator-rubric.md`.
