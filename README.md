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
npx tsx scripts/manage-reports.ts save      # Copiar informe al historial
npx tsx scripts/manage-reports.ts list      # Listar historial
npx tsx scripts/manage-reports.ts rotate 30 # Eliminar informes > 30 días
npx tsx scripts/manage-reports.ts latest    # Mostrar último válido
```

### Build y lint

```bash
npm run build    # Build de producción
npm run lint     # ESLint
npm start        # Servidor de producción
```

## Arquitectura

```
src/
├── app/                    # Next.js App Router (páginas)
│   ├── page.tsx           # Inicio
│   ├── catalogo/          # Explorador de catálogo con filtros
│   ├── calidad/           # Dashboard de calidad global
│   ├── transparencia/     # Portal de transparencia
│   └── gis/               # Auditoría geoespacial
├── components/
│   ├── layout/            # Header, Sidebar, ThemeToggle
│   ├── pages/             # CatalogView
│   ├── quality/           # ScoreGauge, IssueExplorer, DistributionCard
│   └── ui/                # Componentes genéricos (Card, Badge, etc.)
├── lib/
│   ├── rdf-catalog.ts     # Parser RDF/XML del catálogo DCAT
│   ├── quality-report.ts  # Lectura del informe de análisis
│   ├── quality-labels.ts  # Etiquetas de incidencias (client-safe)
│   ├── catalog-filters.ts # Filtros URL (server + client)
│   └── types.ts           # Tipos compartidos
├── analysis/              # Python: descarga, validación, scoring
│   ├── cli.py             # CLI del análisis
│   ├── engine.py          # Motor de descarga y validación
│   └── report.py          # Agregación del informe
└── data/
    └── rdf-catalog.rdf    # Copia local del catálogo (fallback)
```

## Datos

La fuente primaria es el catálogo RDF/DCAT de [datosabiertos.jcyl.es](https://datosabiertos.jcyl.es). Se descarga y parsea en tiempo de request con revalidación de 1 hora. Si el servicio no responde, se usa una copia local en `src/data/rdf-catalog.rdf`.

## Despliegue

```bash
npm run build
npm start
```

El informe de análisis (`reports/data-analysis.json`) se genera con el script Python y se ejecuta periódicamente. Para despliegues automatizados, ejecutar el análisis antes del build:

```bash
python -m src.analysis --limit 0
npm run build
npm start
```

## Licencia

Proyecto interno de la Junta de Castilla y León.
