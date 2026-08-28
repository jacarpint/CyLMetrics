# Desarrollo

Cómo se comprueba y cómo se despliega el portal. El manual del motor de análisis
va aparte, en [`ANALISIS.md`](ANALISIS.md).

Las versiones de Node y de cada dependencia las declara `package.json`, que es la
única fuente: escribirlas también aquí solo crea una copia que se queda atrás.

```bash
git clone https://github.com/jacarpint/CyLMetrics.git
cd CyLMetrics
npm install
npm run dev          # http://localhost:3000
```

## Comprobaciones

```bash
npm run build        # build de producción: el catálogo entero como páginas estáticas
npm run lint         # ESLint
npm run typecheck    # TypeScript sin emitir
npm test             # Vitest — lógica en node, componentes en jsdom
```

```bash
npm run check:contrast   # contraste WCAG AA de la paleta, en claro y en oscuro
npm run verify:broken    # contrasta contra el origen los archivos que el portal da por rotos
npm run check:wfs-view   # pedir por bbox contra el servicio: cuántas entidades caen en cada encuadre
```

Y de extremo a extremo, para las piezas delicadas del visor: `check:xlsx`,
`check:json`, `check:shp`, `check:geo`, `check:table` y `check:tabular`.

### `verify:broken`

Cuando el análisis identifica un archivo como no accesible, esa lectura se vuelve a
comprobar contra el origen, porque una afirmación publicada solo vale si aguanta que
alguien la revise: coge una muestra estratificada por causa, la descarga del origen y
valida el contenido con el mismo criterio que el analizador. No pasa por `/api/proxy`
a propósito —el proxy es del portal, y aquí se trata de salir a por el archivo como
haría cualquiera desde fuera, sin depender de la infraestructura que hizo la lectura.

- `--census` solo enumera las causas, sin descargar ni escribir nada.
- `--sample N` tamaño de la muestra (30 por defecto).
- `--all` comprueba todos los que el portal da por rotos, no una muestra.
- `--out RUTA` dónde escribir el resultado.

Salvo con `--census`, el script deja el resultado en
`reports/current/verification.json`: los recuentos por causa y, uno a uno con su
enlace, todos los archivos que no quedaron confirmados. Queda ahí como evidencia
junto al informe que verifica, y de ahí salen las cifras cuando hay que citarlas.

**El portal no lo lee.** La página de Metodología describe el método y no publica
los resultados de una ejecución concreta: es una página de criterios, no un informe.
Así que este fichero no está declarado en `outputFileTracingIncludes` y no viaja al
despliegue —si alguna vez se pinta en el portal, habrá que añadirlo o la sección
desaparecerá en producción sin fallar en local.

El artefacto guarda el `generated_at` del informe que verificó, y conviene
mantenerlo: `write_bundle` solo vacía `reports/current/d/`, así que el fichero
**sobrevive a un análisis nuevo** y sin esa fecha no habría forma de saber que
describe una foto que ya no está publicada.

## Arquitectura

`src/app` es el App Router: la portada, el explorador del catálogo con su ficha
de conjunto y de archivo, la vista para publicadores, la metodología, las rutas
de API (`quality`, `catalog`, `alerts`, `sello`, `proxy`, `ogc`) y el sitemap.
`src/components` reparte entre disposición, vistas de página, piezas de calidad
—medidores, explorador de tablas, visores geográficos— y primitivas de interfaz.

`src/lib` es la lógica compartida, y es donde está la decisión de diseño que
sostiene el resto: **una sola definición por pregunta**. Los pesos y umbrales en
`quality.ts`; si un archivo se puede abrir, en `availability.ts`; los huecos de la
ficha DCAT, en `metadata-gaps.ts`; el parser del catálogo, en `rdf-catalog.ts`; la
allowlist del proxy y de la CSP, en `proxy-allow.ts`.

`src/analysis` es el motor en Python: CLI, motor de descarga y validación, un
lector por familia de formato y la agregación del informe.

**Stack:** Next.js (App Router) con React y TypeScript · Tailwind CSS · Radix UI ·
Leaflet · Vitest · Python con Frictionless, openpyxl, pyshp, Pillow e icalendar.

### Decisiones que conviene conocer

- **Un solo criterio por pregunta.** Cada regla vive en un módulo y todo lo demás
  lee de ahí. La completitud de metadatos la define `findMetadataGaps` y la nota
  deriva de ella; la disponibilidad la define `classifyDelivery` y nada la
  recalcula por su cuenta. Calcular la nota por un lado y la lista de defectos por
  otro es exactamente cómo el portal llegó a contradecir su propio criterio
  publicado.
- **El catálogo se lee en vivo; el análisis es una foto fechada.** Los dos totales
  no coinciden y el portal lo explica donde aparecen juntos, en vez de dejar que
  parezca un error de cuentas.
- **Accesibilidad.** Toda la paleta verificada AA en claro y en oscuro
  (`npm run check:contrast`), el color nunca como único portador de estado,
  navegación completa por teclado y enlace de salto al contenido.
- **Seguridad.** CSP restrictiva, y el proxy que salta el CORS del visor tiene una
  allowlist explícita de dominios de la Junta que **no** se deriva del RDF en
  tiempo de ejecución: si el catálogo cambiara, el proxy no debe ampliarse solo.
- **La documentación no puede contradecir al código.** Hay tests que contrastan
  contra el fuente de Python los topes que publica la metodología
  (`pipeline-limits`), su fórmula de contenido (`content-scoring`) y los comandos
  que documentan el README y la propia página (`documented-commands`).

## Despliegue

```bash
export NEXT_PUBLIC_SITE_URL=https://cylmetrics.vercel.app
npm run build
npm start
```

`reports/current/` es el artefacto de despliegue y **se versiona**: un índice
ligero (`index.json`) más un fragmento por archivo (`d/<id>.json`) con todas las
posiciones de cada incidencia, el esquema y filas de muestra. El portal enseña
siempre una sola foto, la del informe publicado.

El resto —qué hace `NEXT_PUBLIC_SITE_URL`, por qué las rutas del informe hay que
declararlas en `outputFileTracingIncludes` y de dónde sale el `maxDuration` de las
rutas de API— está en [**Cómo llega al despliegue**](ANALISIS.md#cómo-llega-al-despliegue),
que es donde vive el flujo completo. No se repite aquí a propósito: son avisos que
solo sirven si están actualizados, y dos copias no lo están mucho tiempo.
