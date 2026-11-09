# Documento de Calidad — CyLMetrics (snapshot, A-D)

> Rúbrica = sesión; esto = codebase en el tiempo. Actualizar tras sesiones significativas y antes de benchmarks.

## Dominios de producto

| Dominio | Calif. | Verificación | Legibilidad agente | Estabilidad tests | Brechas clave | Actualizado |
|---|---|---|---|---|---|---|
| Catálogo + fichas dataset/archivo | - | vitest + build | media: App Router disperso | - | - | 2026-10-10 |
| /calidad + redirecciones legacy | - | smoke manual | alta: LEGACY_VISTAS mapeadas | - | - | 2026-10-10 |
| Visores XLSX/JSON/SHP/GEO/tabla/tabular | - | check:* scripts | media: lógica en lib + scripts | - | - | 2026-10-10 |
| APIs quality/catalog/alerts/sello/proxy/ogc | - | vitest + 503 prod si tracing falla | alta: proxy-allow explícita | - | riesgo tracing | 2026-10-10 |
| Metodología/API/glosario | - | documented-* tests | alta | - | - | 2026-10-10 |
| Motor análisis (7 lectores + aggregate) | - | pytest 47 + --check-deps | alta: ANALISIS.md 249 líneas | estable | OneDrive/checkpoint | 2026-10-10 |
| Informes reports/current + verification.json | - | verify:broken | alta | - | blobs grandes | 2026-10-10 |
| Accesibilidad WCAG AA + CSP/seguridad | - | check:contrast | alta | - | - | 2026-10-10 |

## Capas

| Capa | Calif. | Límites | Legibilidad | Brechas | Actualizado |
|---|---|---|---|---|---|
| `src/app` (rutas) | - | - | - | - | 2026-10-10 |
| `src/components` | - | - | - | - | 2026-10-10 |
| `src/lib` (definición única) | - | fuerte: quality/availability/gaps/rdf/proxy | - | - | 2026-10-10 |
| `src/analysis` (Python) | - | --strict-deps | - | venv OneDrive | 2026-10-10 |
| `scripts/` + `tests/` | - | - | - | - | 2026-10-10 |

## Historial

### 2026-10-10 — baseline harness

- Harness aplicado sobre repo maduro (docs excelentes, AGENTS solo banner).
- Pendiente: primer `init` verde documentado + calificar A-D de verdad tras ejecución.
