# Entrega de Sesión — CyLMetrics

## Verificado Ahora

- Qué funciona: 2026-11-09 — lint y typecheck en verde, vitest 556/556, pytest 147/147, build completo y deploy de Vercel `success` con el informe nuevo en producción.
- Verificación ejecutada: `npm run lint` 0 · `npm run typecheck` 0 · `npm test` 556 passed · `pytest src/analysis/tests -q` 147 passed · `python -m src.analysis --check-deps` OK · `npm run build` 0 · `/api/quality` en producción devuelve `2026-11-09T10:47:32Z` y 1.728 distribuciones.

## Cambiado En Esta Sesión

- Código portal (`src/app`, `src/components`, `src/lib`): sin cambios.
- Motor (`src/analysis/`): docstring de `cli.py` con `--incremental --output` explícito.
- Harness/docs: base del harness versionada (`cf17ddd`); `ANALISIS.md` con los dos comandos incrementales; `feature_list.json` y `claude-progress.md` actualizados.
- Datos: `reports/current/` reemplazado por el informe del 9 de noviembre (854 datasets, 1.728 distribuciones, 1.258 fragmentos).

## Roto O Sin Verificar

- Defecto conocido: los CSV de 512 MiB tardan ~35–38 min cada uno porque el motor usa hilos y el GIL serializa el parseo. No es falta de memoria (8,6 GB de 31,7 GB).
- Ruta sin verificar (visores: xlsx/json/shp/geo/table/tabular): smoke manual de los seis visores.
- Riesgo despliegue (`reports/current/`, `outputFileTracingIncludes`, `maxDuration`): `outputFileTracingIncludes` incluye `reports/current/d/**`; `/api/quality` responde 200 en producción, así que el bundle viaja.

## Mejor Próximo Paso

- Feature (id + título de `feature_list.json`): `portal-001` — Catálogo + ficha sin regresiones.
- Por qué es la siguiente: el dato ya está publicado y verificado; falta la pasada E2E de interfaz.
- Qué cuenta como aprobado (E2E concreto): abrir `/catalogo`, entrar en un dataset y en un archivo, sin errores de consola ni terminal; build estático OK.
- Qué no tocar: `reports/current/` (no reanalizar sin motivo), `outputFileTracingIncludes`.

## Comandos

- Inicio: `.\init.ps1` / `./init.sh`
- Portal: `npm run dev` → http://localhost:3000
- Checks: `npm run check:contrast`, `npm run verify:broken --census`, `check:wfs-view`, `check:xlsx|json|shp|geo|table|tabular`
- Motor: `python -m src.analysis --check-deps` · `python -m pytest src/analysis/tests -q` · `npm run reports:seed -- --dry-run`
