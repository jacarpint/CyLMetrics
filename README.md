<div align="center">

# CyLMetrics

**Auditoría independiente de la calidad del catálogo de datos abiertos de Castilla y León.**

[![Portal en vivo](https://img.shields.io/badge/portal-cylmetrics.vercel.app-0b5cab?style=flat-square)](https://cylmetrics.vercel.app)
[![Licencia EUPL 1.2](https://img.shields.io/badge/licencia-EUPL--1.2-1a9e5c?style=flat-square)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?style=flat-square)](https://nextjs.org)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776ab?style=flat-square)](https://www.python.org)

</div>

---

## Qué es

La mayoría de los observatorios de datos abiertos miden **fichas**: cuentan cuántos campos rellena cada conjunto de datos y publican una nota. Un catálogo puede sacar sobresaliente así y tener la mitad de sus archivos caídos.

CyLMetrics hace la comprobación que falta: **descarga cada archivo publicado en el catálogo y lo abre**, con el lector que le corresponde, igual que haría quien quiere reutilizarlo. Después publica el resultado archivo por archivo, con el motivo de cada fallo, la metodología completa y una API abierta para contrastarlo.

En el último análisis eso son **1.662 archivos y 23,5 GB descargados y abiertos uno a uno**.

## Qué encuentra

Cifras del análisis del **14 de agosto de 2026**, sobre 822 conjuntos de datos y sus 1.662 archivos:

| | |
|---|---|
| **14 %** de los archivos | no se pueden descargar o no se pueden abrir (227 de 1.662) |
| **127 archivos** | devuelven una página web en lugar del dato |
| **259 conjuntos** de 822 | tienen al menos un archivo inservible |
| **90,3 %** de calidad media | sobre los 1.306 archivos que sí abren y tienen contenido que medir |
| **761 de 836 conjuntos** | no publican `dct:modified`, así que su actualidad no se puede verificar |

Cada cifra del portal se calcula desde el informe publicado; ninguna está escrita a mano.

## Cómo se mide

Dos preguntas distintas, medidas por separado porque **promediarlas engaña en las dos direcciones**:

- **Disponibilidad** — ¿se descarga y se abre el archivo? Es bloqueante.
- **Calidad de contenido** — ¿está limpio? Encabezados, tipos de dato, celdas vacías. Solo tiene sentido sobre lo que sí abre.

El índice compuesto de cada ficha pondera `40 % metadatos + 30 % disponibilidad + 30 % contenido`, con umbrales ≥80 buena / 50-79 mejorable / <50 deficiente. Los pesos y los umbrales viven en un único módulo (`src/lib/quality.ts`) del que leen la interfaz, la API, el sello y la propia página de metodología, y hay tests que impiden que la documentación publicada contradiga al código.

La metodología completa —alcance, fórmulas, umbrales, límites conocidos y lo que el análisis decide **no** imputar a quien publica— está en [**/metodologia**](https://cylmetrics.vercel.app/metodologia).

## Dos audiencias

| Sección | Para quién | Qué resuelve |
|---|---|---|
| [`/catalogo`](https://cylmetrics.vercel.app/catalogo) | quien **reutiliza** | buscar un conjunto, ver si sus archivos abren y qué estructura tienen antes de invertir tiempo. Cada ficha descarga el archivo real en tu navegador y lo pinta como tabla, esquema o mapa |
| [`/calidad`](https://cylmetrics.vercel.app/calidad) | quien **publica** | qué está roto y qué hay que hacer, ordenado por lo que se recupera al corregirlo, descargable en CSV con los filtros puestos |

Los defectos se reducen a tres familias, que son también tres tipos de corrección distintos: **entrega** (el archivo no llega o no se interpreta), **contenido** (llega, pero sucio) y **metadatos** (la ficha está incompleta). Cuando un fallo alcanza a un formato entero sube el primero, porque delata un proceso de publicación y se arregla de una vez.

## API pública

Un observatorio de datos abiertos debería publicar también los suyos. Todo lo que se ve en el portal está en JSON, **sin registro, sin clave y sin límite de peticiones**:

```bash
curl https://cylmetrics.vercel.app/api/quality                       # informe global
curl https://cylmetrics.vercel.app/api/quality?dataset=1285663381041 # un conjunto
curl https://cylmetrics.vercel.app/api/catalog?q=padron&limit=5      # catálogo filtrable
curl https://cylmetrics.vercel.app/api/alerts                        # incidencias abiertas
```

Y un sello de calidad incrustable en cualquier web, que refleja siempre el último análisis:

```html
<img src="https://cylmetrics.vercel.app/api/sello?dataset=1285663381041" alt="Índice de calidad">
```

Referencia completa en [**/api**](https://cylmetrics.vercel.app/api).

## Arranque rápido

**Requisitos:** Node.js `^20.19` o `>=22.12` · npm · Python `>=3.10` (solo para ejecutar el análisis).

```bash
git clone https://github.com/jacarpint/CyLMetrics.git
cd CyLMetrics
npm install
npm run dev          # http://localhost:3000
```

El portal arranca con el informe ya versionado en `reports/current/`, así que no hace falta ejecutar el análisis para verlo funcionando.

### Comprobaciones

```bash
npm run build        # build de producción (~2.500 páginas estáticas)
npm run lint         # ESLint
npm run typecheck    # TypeScript sin emitir
npm test             # Vitest — 35 ficheros de test
npm run check:contrast   # contraste WCAG AA de la paleta, en claro y en oscuro
```

Hay además comprobaciones de extremo a extremo para las piezas delicadas del visor: `check:xlsx`, `check:json`, `check:shp`, `check:geo`, `check:table` y `check:tabular`.

## El análisis

El motor de análisis es Python y **se ejecuta en local**: descarga el catálogo entero, abre cada archivo con su lector y escribe el informe. Solo el resultado viaja al despliegue.

```bash
pip install -r requirements-analysis.txt

python -m src.analysis --limit 1 --strict-deps   # verifica el entorno antes de bajar 23 GB
python -m src.analysis --limit 0                 # análisis completo
```

> [!IMPORTANT]
> Ejecuta siempre `--strict-deps` antes de un análisis largo. Si falta un lector, el informe **no falla**: archiva en silencio como «no analizado» todo lo que no pudo abrir. Ha pasado dos veces, y una llegó a producción con 341 XLSX marcados como ilegibles que estaban perfectos.

Lee **[`docs/ANALISIS.md`](docs/ANALISIS.md)** para el manual completo: opciones del CLI, reanudación desde checkpoint para no volver a descargar 23 GB, formato del informe y los avisos de operación que conviene conocer.

## Arquitectura

```
src/
├── app/                 # Next.js App Router
│   ├── page.tsx         # Inicio
│   ├── catalogo/        # Explorador, ficha de conjunto y ficha de archivo
│   ├── calidad/         # Para publicadores: prioridades, ficheros, metadatos
│   ├── metodologia/     # Pesos, umbrales y límites declarados
│   ├── api/             # quality, catalog, alerts, sello, proxy, ogc
│   └── sitemap.ts       # ~2.500 URLs
├── components/
│   ├── layout/          # Header, Sidebar, buscador, tema
│   ├── pages/           # Vistas de catálogo y calidad
│   ├── quality/         # Medidores, explorador de tablas, visores geográficos
│   └── ui/              # Primitivas (Card, Badge, Sheet…)
├── lib/                 # Lógica compartida — fuente única de cada criterio
│   ├── quality.ts       # Pesos 40/30/30 y umbrales
│   ├── availability.ts  # ¿Se puede abrir el archivo? (eje independiente)
│   ├── metadata-gaps.ts # Huecos de la ficha DCAT y diagnóstico de actualidad
│   ├── rdf-catalog.ts   # Parser RDF/XML del catálogo DCAT
│   └── proxy-allow.ts   # Allowlist de dominios del proxy y de la CSP
└── analysis/            # Python: descarga, validación y puntuación
    ├── cli.py           # CLI del análisis
    ├── engine.py        # Motor de descarga y validación
    ├── formats/         # Un lector por familia de formato
    └── report.py        # Agregación del informe
```

**Stack:** Next.js 16 (App Router, React 19) · TypeScript · Tailwind CSS 4 · Radix UI · Leaflet · Vitest · Python 3.10+ con Frictionless, openpyxl, pyshp, Pillow e icalendar.

**Un lector por formato.** En el último análisis se abrieron 16: CSV, XLSX, JSON, SHP, XML, GML, KML, RDF, RSS, iCal, ECW, TXT, WMS, WFS, binarios y sin clasificar.

### Decisiones que conviene conocer

- **Un solo criterio por pregunta.** Cada regla vive en un módulo y todo lo demás lee de ahí. La completitud de metadatos la define `findMetadataGaps` y la nota deriva de ella; la disponibilidad la define `classifyDelivery` y nada la recalcula por su cuenta. Calcular la nota por un lado y la lista de defectos por otro es exactamente cómo el portal llegó a contradecir su propio criterio publicado.
- **El catálogo se lee en vivo; el análisis es una foto fechada.** Los dos totales no coinciden y el portal lo explica donde aparecen juntos, en vez de dejar que parezca un error de cuentas.
- **Accesibilidad.** 92 combinaciones de color verificadas AA en claro y en oscuro (`npm run check:contrast`), el color nunca como único portador de estado, navegación completa por teclado y enlace de salto al contenido.
- **Seguridad.** CSP restrictiva, y el proxy que salta el CORS del visor tiene una allowlist explícita de dominios de la Junta que **no** se deriva del RDF en tiempo de ejecución: si el catálogo cambiara, el proxy no debe ampliarse solo.

## Despliegue

```bash
export NEXT_PUBLIC_SITE_URL=https://cylmetrics.vercel.app
npm run build
npm start
```

`NEXT_PUBLIC_SITE_URL` es lo que usan `sitemap.xml`, `robots.txt` y las tarjetas Open Graph para construir URLs absolutas.

`reports/current/` es el artefacto de despliegue y **se versiona**: un índice ligero (`index.json`) más un fragmento por archivo (`d/<id>.json`) con todas las posiciones de cada incidencia, el esquema y filas de muestra. El portal enseña siempre una sola foto, la del informe publicado.

> [!WARNING]
> Esos ficheros se leen con `fs` desde rutas construidas en tiempo de ejecución, así que el rastreador de Next no las ve y hay que declararlas en `outputFileTracingIncludes` (`next.config.ts`). Sin esa lista el informe no viaja al despliegue, `/api/quality` responde 503 y el portal se renderiza sin datos. En local no se nota.

## Licencia

Copyright © 2026 Javier Carpintero

Licensed under the EUPL — ver [`LICENSE`](LICENSE) para el texto completo de la [Licencia Pública de la Unión Europea v. 1.2](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12), disponible también [en castellano](https://joinup.ec.europa.eu/sites/default/files/custom-page/attachment/eupl_v1.2_es.pdf).

Los **datos** analizados son propiedad de la Junta de Castilla y León y se publican bajo las condiciones de reutilización de su [portal de datos abiertos](https://datosabiertos.jcyl.es). Esta licencia cubre únicamente el código de este repositorio y los resultados del análisis.

## Aviso

CyLMetrics es un **proyecto independiente**. No está desarrollado, mantenido, financiado ni respaldado por la Junta de Castilla y León. Su única relación con la administración es que analiza un catálogo que esta publica abiertamente.

Los pesos y umbrales del índice de calidad son criterio de este proyecto, **no un estándar oficial**, y así se declara en la propia página de metodología.

Propuesta presentada al [X Concurso de Datos Abiertos de Castilla y León](https://datosabiertos.jcyl.es/web/es/concurso-datos-abiertos/concurso-datos-abiertos.html), categoría de Productos y Servicios.
