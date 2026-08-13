# JCyL Data Quality Portal

Observatorio de la calidad del catálogo de datos abiertos de la Junta de Castilla y León. Analiza automáticamente metadatos, formatos, licencias y disponibilidad de datasets públicos.

## Requisitos

- **Node.js** >= 18
- **Python** >= 3.10 (para el análisis de datos)
- **npm**

## Instalación

```bash
# Instalar dependencias Node
npm install

# Crear entorno virtual Python (opcional, para análisis)
python -m venv .venv-analysis
.venv-analysis\Scripts\activate   # Windows
# source .venv-analysis/bin/activate  # macOS/Linux

# Instalar dependencias Python
pip install -r requirements-analysis.txt
```

## Desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Scripts disponibles

### Análisis de calidad (Python)

```bash
# Analizar todas las distribuciones
python -m src.analysis --limit 0

# Analizar primeras 25 distribuciones
python -m src.analysis --limit 25

# Solo formatos CSV/XLSX
python -m src.analysis --only-formats CSV,XLSX

# Con workers paralelos y tope de descarga
python -m src.analysis --limit 0 --workers 16 --size-cap 536870912
```

El informe se escribe en `reports/current/` como un índice ligero más un
fragmento por distribución (ver «Despliegue»). Se guardan **todas** las
ocurrencias de cada incidencia, no una muestra: es lo que permite que el
recuento del resumen y el detalle de la ficha sean la misma cifra.

### Gestión de informes

```bash
npm run reports:snapshots     # Regenerar reports/current/snapshots.json
npm run reports -- list       # Listar el historial del formato antiguo
npm run reports -- rotate 30  # Eliminar informes antiguos > 30 días
```

`reports:snapshots` hay que ejecutarlo después de cada análisis: es lo que
alimenta la pestaña de evolución. Descarta las ejecuciones parciales (menos de
50 datasets), igual que la lectura del informe en el portal.

### Build, lint y comprobaciones

```bash
npm run build          # Build de producción
npm run lint           # ESLint
npm run typecheck      # TypeScript sin emitir
npm test               # Vitest
npm start              # Servidor de producción

npm run check:contrast # Contraste WCAG de la paleta, en claro y oscuro
npm run check:xlsx     # Lectura de XLSX en navegador
npm run check:json     # Detección de registros en JSON
npm run check:shp      # Lectura de shapefiles
npm run check:geo      # Pipeline geoespacial completo
npm run check:table    # Visor de tablas
npm run check:tabular  # Análisis tabular en cliente
```

## Arquitectura

```
src/
├── app/                    # Next.js App Router (páginas)
│   ├── page.tsx           # Inicio
│   ├── catalogo/          # Explorador de catálogo, ficha y distribución
│   ├── calidad/           # Para publicadores: prioridades, ficheros, metadatos, evolución
│   ├── metodologia/       # Pesos, umbrales, sello y API pública
│   ├── api/               # quality, catalog, alerts, sello, proxy, ogc
│   ├── not-found.tsx      # 404 propia
│   ├── sitemap.ts         # ~2.500 URLs (catálogo + distribuciones)
│   └── robots.ts
├── components/
│   ├── layout/            # Header, Sidebar, ThemeToggle, FilterContent
│   ├── pages/             # CatalogView, BrokenFilesView, AlertasList, calidad/*
│   ├── quality/           # ScoreGauge, FileExplorer, TableExplorer, mapas
│   └── ui/                # Componentes genéricos (Card, Badge, Sheet, etc.)
├── lib/
│   ├── rdf-catalog.ts     # Parser RDF/XML del catálogo DCAT
│   ├── quality-report.ts  # Lectura del informe (caché por firma de fichero)
│   ├── quality.ts         # Calidad global 40/30/30 y umbrales (única fuente)
│   ├── availability.ts    # ¿Se puede abrir el archivo? (eje independiente)
│   ├── quality-labels.ts  # Etiquetas de incidencias (client-safe)
│   ├── metadata-gaps.ts   # Huecos de la ficha DCAT y diagnóstico de actualidad
│   ├── repair-actions.ts  # Lista de tareas del publicador, por impacto
│   ├── catalog-filters.ts # Filtros URL (server + client)
│   ├── proxy-allow.ts     # Allowlist de dominios del proxy y de la CSP
│   └── types.ts           # Tipos compartidos
├── analysis/              # Python: descarga, validación, scoring
│   ├── cli.py             # CLI del análisis
│   ├── engine.py          # Motor de descarga y validación
│   └── report.py          # Agregación del informe
└── data/
    └── rdf-catalog.rdf    # Copia local del catálogo (fallback)
```

Las rutas `/gis`, `/transparencia`, `/alertas` y `/tendencias` son redirecciones
a la pestaña correspondiente de `/calidad`, para que los enlaces antiguos sigan
funcionando. Las vistas anteriores de `/calidad` (`?vista=resumen`, `reparar`,
`incidencias`, `organismos`) también se mapean a las nuevas en `LEGACY_VISTAS`.

## Dos audiencias

- **`/catalogo`** es para quien **reutiliza**: buscar un dataset, ver si sus
  archivos abren y qué estructura tienen antes de invertir tiempo en él.
- **`/calidad`** es para quien **publica**: qué está roto y qué hay que hacer,
  ordenado por lo que se recupera al corregirlo. Tres familias de defecto, que
  son también tres tipos de corrección distintos:

  | Familia | Qué pasa | Dónde |
  |---|---|---|
  | Entrega | el fichero no llega o no se puede interpretar | pestaña Ficheros |
  | Contenido | el fichero abre, pero los datos vienen sucios | pestaña Ficheros |
  | Metadatos | la ficha DCAT está incompleta o no permite verificar nada | pestaña Metadatos |

  `repair-actions.ts` reduce las tres a un mismo modelo de tarea y las ordena por
  impacto; los fallos que alcanzan a un formato entero suben primero porque
  delatan un proceso de publicación y se arreglan de una vez.

## Cómo se mide la calidad

Son dos preguntas distintas y se responden por separado, porque promediarlas
engaña en las dos direcciones:

- **Disponibilidad** — ¿se descarga y se abre el archivo? Es bloqueante.
- **Calidad de contenido** — ¿está limpio? Encabezados, tipos, celdas vacías.
  Solo tiene sentido sobre lo que sí abre.

Un archivo es «no disponible» únicamente si la descarga falla (`fetch.status` de
`http_error`, `unreachable` o `service`) o si llega y no se puede interpretar
(algún código de `BLOCKING_ISSUE_CODES`: JSON inválido, ZIP corrupto, shapefile
incompleto…). **No basta con que `engine.py` le ponga `status: 'error'`**: ese
estado se activa con cualquier incidencia de severidad error, y «tipos mezclados
en una columna» es una de ellas. Ese detalle inflaba la disponibilidad del 16%
real al 35%, porque 328 de las 582 marcadas en error se descargan, se abren y
devuelven filas. La regla vive en `classifyDelivery` de `src/lib/availability.ts`.

La **calidad global** que aparece en cada ficha pondera `40% metadatos +
30% disponibilidad + 30% contenido`. Los umbrales (≥80 buena, 50–79 mejorable,
<50 deficiente) viven en un único sitio, `getScoreLevel` de `src/lib/quality.ts`;
la interfaz, la API y el sello los leen de ahí.

### Actualidad: «no verificable» no es «vencido»

La actualidad pesa un 25% del score de metadatos y se mide contra la periodicidad
declarada. El problema es la fecha de referencia: **749 de 824 datasets no
publican `dct:modified`**, así que la única fecha disponible es la de publicación
y el cálculo los trata como si llevaran siglos sin refrescarse. De los que
aparecen con retraso, solo 58 lo tienen demostrado (publican `dct:modified` y lo
han pasado); los otros 670 lo tienen *aparente*.

`diagnoseFreshness` distingue los cinco casos (`al-dia`, `vencido`,
`no-verificable`, `sin-periodicidad`, `sin-fecha`) para poder decirlo bien en la
interfaz. **No cambia la puntuación**: son dos acciones distintas —publicar el
metadato o actualizar el dato— y el portal ahora las presenta separadas.

### Completitud: una sola definición

`findMetadataGaps` (`src/lib/metadata-gaps.ts`) es la única lista de qué campos
cuentan, y `computeQuality` deriva de ella su 40% de completitud. Calcular la nota
por un lado y la lista de huecos por otro es exactamente cómo `classifyDelivery`
llegó a contradecir el criterio que decía aplicar.

## Datos

La fuente primaria es el catálogo RDF/DCAT de [datosabiertos.jcyl.es](https://datosabiertos.jcyl.es). Se descarga y parsea en tiempo de request con revalidación de 1 hora. Si el servicio no responde, se usa una copia local en `src/data/rdf-catalog.rdf`.

## Despliegue

```bash
npm run build
npm start
```

Configura `NEXT_PUBLIC_SITE_URL` con el dominio público: es lo que usan
`sitemap.xml` y `robots.txt` para construir las URLs absolutas.

El análisis se ejecuta **en local** y solo su resultado viaja al despliegue. No
hay periodicidad establecida: cada informe es una foto fechada, y el portal
enseña siempre la fecha del que está publicado.

```bash
export NEXT_PUBLIC_SITE_URL=https://mi-dominio.es
python -m src.analysis --limit 0   # escribe reports/current/
npm run reports:snapshots          # actualiza la serie de la pestaña Evolución
npm run build
```

`reports/current/` es el artefacto de despliegue y **se versiona**:

| Fichero | Qué lleva |
|---|---|
| `index.json` | Totales, por formato y, por distribución, estado y recuento de cada incidencia |
| `d/<id>.json` | Todas las posiciones de cada incidencia, el esquema y filas de muestra |
| `snapshots.json` | Un punto por ejecución para la pestaña Evolución |

### Al desplegar en Vercel

Esos ficheros se leen con `fs` desde rutas que se construyen en tiempo de
ejecución, así que el rastreador de Next no las ve y hay que declararlas en
`outputFileTracingIncludes` (`next.config.ts`). Si se tocan las rutas, hay que
tocar también esa lista: sin ella el informe no viaja al despliegue, `/api/quality`
responde 503 y el portal se renderiza sin datos. En local no se nota, porque ahí
los ficheros están en disco.

Las rutas `/api/proxy` y `/api/ogc` declaran `maxDuration`; el valor sale de
`PLATFORM_MAX_DURATION_S` en `src/lib/download-budget.ts`, que es también de
donde se deriva el plazo del proxy. 60 s es el máximo del plan Hobby.

## Licencia

Proyecto interno de la Junta de Castilla y León.
