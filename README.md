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

# Con workers paralelos y tamaño máximo
python -m src.analysis --limit 0 --workers 16 --size-cap 52428800
```

El informe se guarda en `reports/data-analysis.json` y se auto-copía al historial en `reports/history/`.

### Gestión de informes

```bash
npm run reports -- save       # Copiar informe al historial
npm run reports -- list       # Listar historial
npm run reports -- rotate 30  # Eliminar informes > 30 días
npm run reports -- latest     # Mostrar último válido
npm run reports:index         # Regenerar reports/history-index.json
```

`reports:index` hay que ejecutarlo después de cada `save`: es lo que alimenta la
pestaña de evolución. Descarta las ejecuciones parciales (menos de 50 datasets),
igual que la lectura del historial en el portal.

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

El informe de análisis (`reports/data-analysis.json`) se genera con el script
Python y se ejecuta periódicamente. Para despliegues automatizados:

```bash
export NEXT_PUBLIC_SITE_URL=https://mi-dominio.es
python -m src.analysis --limit 0   # genera reports/data-analysis.json
npm run reports -- save            # lo archiva en reports/history/
npm run reports:index              # regenera el índice de evolución
npm run build
npm start
```

Si `reports/data-analysis.json` no existe (está en `.gitignore`), el portal usa
el informe más reciente de `reports/history/`. La lectura está cacheada por
firma del fichero: se reparsea solo cuando el informe cambia.

## Licencia

Proyecto interno de la Junta de Castilla y León.
