<div align="center">

# CyLMetrics

**Auditoría independiente de la calidad del catálogo de datos abiertos de Castilla y León.**

[![Portal en vivo](https://img.shields.io/badge/portal-cylmetrics.vercel.app-0b5cab?style=flat-square)](https://cylmetrics.vercel.app)
[![Licencia EUPL 1.2](https://img.shields.io/badge/licencia-EUPL--1.2-1a9e5c?style=flat-square)](LICENSE)

</div>

---

## Qué es

La mayoría de los observatorios de datos abiertos miden **fichas**: cuentan cuántos campos rellena cada conjunto de datos y publican una nota. Un catálogo puede sacar sobresaliente así y tener la mitad de sus archivos caídos.

CyLMetrics hace la comprobación que falta: **descarga cada archivo publicado en el catálogo y lo abre**, con el lector que le corresponde, igual que haría quien quiere reutilizarlo. Después publica el resultado archivo por archivo, con el motivo de cada fallo, la metodología completa y una API abierta para contrastarlo.

En el último análisis eso son **más de mil quinientos archivos y más de 20 GB descargados y abiertos uno a uno**.

## Qué encuentra

| | |
|---|---|
| **uno de cada siete** archivos | no se puede descargar o no se puede abrir |
| **más de un centenar** de archivos | devuelven una página web en lugar del dato |
| **casi uno de cada tres** conjuntos | tiene al menos un archivo inservible |
| **alrededor del 90 %** de calidad media | sobre los archivos que sí abren y tienen contenido que medir |
| **nueve de cada diez** conjuntos | no publican `dct:modified`, así que su actualidad no se puede verificar |

Cada cifra del **portal** se calcula desde el informe publicado; ninguna está escrita a mano. Aquí van en proporciones a propósito: son estables entre análisis, y así este README no puede quedar desmintiendo al informe que describe. Los recuentos exactos, con su fecha, están en [el portal](https://cylmetrics.vercel.app) y en [`/api/quality`](https://cylmetrics.vercel.app/api/quality).

## Cómo se mide

Dos preguntas distintas, medidas por separado porque **promediarlas engaña en las dos direcciones**:

- **Disponibilidad** — ¿se descarga y se abre el archivo? Es bloqueante.
- **Calidad de contenido** — ¿está limpio? Encabezados, tipos de dato, celdas vacías. Solo tiene sentido sobre lo que sí abre.

Cada conjunto recibe además un índice compuesto que pesa esas dos preguntas junto con la completitud de su ficha. Los pesos, los umbrales, los límites conocidos y lo que el análisis decide **no** imputar a quien publica están declarados en [**/metodologia**](https://cylmetrics.vercel.app/metodologia).

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

```bash
git clone https://github.com/jacarpint/CyLMetrics.git
cd CyLMetrics
npm install
npm run dev          # http://localhost:3000
```

El portal arranca con el informe del último análisis ya incluido en el repositorio, así que no hace falta ejecutar nada más para verlo funcionando.

## El análisis

El motor de análisis es Python y **se ejecuta en local**: descarga el catálogo entero, abre cada archivo con el lector que le corresponde —CSV, XLSX, JSON, shapefiles, XML, GML, KML, RDF, RSS, calendarios, imágenes y servicios WMS y WFS— y escribe el informe. Solo el resultado viaja al despliegue.

```bash
pip install -r requirements-analysis.txt

python -m src.analysis --check-deps    # ¿está el entorno listo? No descarga ni escribe nada
python -m src.analysis --limit 0       # análisis completo
```

Conviene empezar siempre por `--check-deps`: si falta un lector el informe **no falla**, archiva en silencio como «no analizado» todo lo que no pudo abrir.

> [!CAUTION]
> `--output` vale `reports/current` por defecto, que es **el informe que publica el portal**. Cualquier ejecución de prueba tiene que apuntar a otro sitio, o se lo lleva por delante.

Cuando el portal identifica un archivo como no accesible, esa lectura se vuelve a comprobar: `npm run verify:broken` pide cada archivo al servidor de origen, entero y **sin pasar por el proxy del portal**, para que la comprobación no dependa de la misma infraestructura que la hizo, y contrasta el resultado con lo que dice el informe. El método está descrito en [**/metodologia#verificacion**](https://cylmetrics.vercel.app/metodologia#verificacion).

Manual completo del análisis en [**`docs/ANALISIS.md`**](docs/ANALISIS.md). Comprobaciones, arquitectura y despliegue, en [**`docs/DESARROLLO.md`**](docs/DESARROLLO.md).

## Licencia

Copyright © 2026 Javier Carpintero

Licensed under the EUPL — ver [`LICENSE`](LICENSE) para el texto completo de la [Licencia Pública de la Unión Europea v. 1.2](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12), disponible también [en castellano](https://joinup.ec.europa.eu/sites/default/files/custom-page/attachment/eupl_v1.2_es.pdf).

Los **datos** analizados son propiedad de la Junta de Castilla y León y se publican bajo las condiciones de reutilización de su [portal de datos abiertos](https://datosabiertos.jcyl.es). Esta licencia cubre únicamente el código de este repositorio y los resultados del análisis.

## Aviso

CyLMetrics es un **proyecto independiente**. No está desarrollado, mantenido, financiado ni respaldado por la Junta de Castilla y León. Su única relación con la administración es que analiza un catálogo que esta publica abiertamente.

Los pesos y umbrales del índice de calidad son criterio de este proyecto, **no un estándar oficial**, y así se declara en la propia página de metodología.

Propuesta presentada al [X Concurso de Datos Abiertos de Castilla y León](https://datosabiertos.jcyl.es/web/es/concurso-datos-abiertos/concurso-datos-abiertos.html), categoría de Productos y Servicios.
