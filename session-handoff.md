# Entrega de Sesión — CyLMetrics

## Verificado Ahora

- Qué funciona: (último `init` verde + fecha; ej. lint/typecheck/vitest + pytest 47 passed)
- Verificación ejecutada: (pega comandos + outputs)

## Cambiado En Esta Sesión

- Código portal (`src/app`, `src/components`, `src/lib`):
- Motor (`src/analysis/`):
- Harness/docs:

## Roto O Sin Verificar

- Defecto conocido:
- Ruta sin verificar (visores: xlsx/json/shp/geo/table/tabular):
- Riesgo despliegue (`reports/current/`, `outputFileTracingIncludes`, `maxDuration`):

## Mejor Próximo Paso

- Feature (id + título de `feature_list.json`):
- Por qué es la siguiente:
- Qué cuenta como aprobado (E2E concreto):
- Qué no tocar:

## Comandos

- Inicio: `.\init.ps1` / `./init.sh`
- Portal: `npm run dev` → http://localhost:3000
- Checks: `npm run check:contrast`, `npm run verify:broken --census`, `check:wfs-view`, `check:xlsx|json|shp|geo|table|tabular`
- Motor: `python -m src.analysis --check-deps` · `python -m pytest src/analysis/tests -q` · `npm run reports:seed -- --dry-run`
