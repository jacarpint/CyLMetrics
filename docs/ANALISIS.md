# El análisis de calidad

Manual de operación del motor Python que descarga el catálogo, abre cada archivo y
escribe el informe que consume el portal.

El análisis **se ejecuta en local** y solo su resultado viaja al despliegue. No hay
periodicidad establecida: cada informe es una foto fechada, y el portal enseña
siempre la fecha del que está publicado.

## Preparar el entorno

> [!IMPORTANT]
> **Python 3.12 o superior**, y no es una preferencia de estilo. El analizador abre
> XML que descarga de Internet con `xml.etree.ElementTree`, y la defensa contra la
> expansión de entidades —*billion laughs*: un documento de 400 bytes que se
> expande a gigas— la pone el propio intérprete, no este código. Comprobado en
> 3.12: el ataque rebota con «limit on input amplification factor breached». En
> versiones anteriores esa protección no está activada por defecto, así que el
> mismo documento tumbaría el análisis.
>
> `--check-deps` lo comprueba junto con los lectores, y aborta si no se cumple.

```bash
python -m venv .venv-analysis
.venv-analysis\Scripts\activate      # Windows
# source .venv-analysis/bin/activate # macOS/Linux

pip install -r requirements-analysis.txt

# Comprobar que están los siete lectores (no imprime nada si están todos)
python -c "from src.analysis.formats import missing_readers; print(missing_readers() or 'todos los lectores disponibles')"
```

El entorno de Python no es opcional si vas a ejecutar el análisis: sin sus lectores
el informe sale a medias y **no falla**, solo archiva como «no analizado» todo lo
que no ha podido abrir.

> [!TIP]
> **Si el repositorio está en OneDrive, crea el entorno fuera de la carpeta
> sincronizada.** Un venv con `frictionless` son unos 3.000 ficheros, y el
> cliente de sincronización los va a copiar todos y a mantenerlos abiertos
> mientras `pytest` los lee. Es el mismo problema que el checkpoint (ver abajo),
> y se evita igual:
>
> ```bash
> python -m venv %LOCALAPPDATA%\venvs\cylmetrics
> %LOCALAPPDATA%\venvs\cylmetrics\Scripts\python -m pip install -r requirements-analysis.txt
> ```
>
> El intérprete funciona igual desde la raíz del repositorio; `.venv-analysis`
> está en `.gitignore` para quien no tenga este problema.

## Tests

```bash
python -m pytest src/analysis/tests -q     # 47 tests
```

Cubren los analizadores de cada formato del catálogo, la agregación del informe
(`test_report.py`) y el descargador (`test_downloader.py`). Los dos últimos son
recientes: esos módulos no tenían ni un test, y los dos fallos más serios que ha
tenido el proyecto —la nota de contenido que descartaba todo lo que puntuaba por
debajo de 80, y los diez CSV acusados de no descargarse cuando se descargan
perfectamente— vivían justo ahí.

## Ejecutar

```bash
# Comprobar el entorno antes de descargar 23 GB: aborta si falta algún lector
python -m src.analysis --check-deps

# Analizar todas las distribuciones
python -m src.analysis --limit 0

# Analizar las primeras 25 distribuciones
python -m src.analysis --limit 25 --output reports/prueba

# Solo formatos CSV/XLSX
python -m src.analysis --only-formats CSV,XLSX --output reports/prueba

# Con workers paralelos y tope de descarga
python -m src.analysis --limit 0 --workers 16 --size-cap 536870912
```

> [!IMPORTANT]
> **Comprueba las dependencias antes de lanzar un análisis largo.** Al arrancar se
> avisa de los lectores que falten (`openpyxl`, `pyshp`, `icalendar`, `geojson`,
> `Pillow`, `filetype`, `frictionless`) y de los formatos que quedarán sin
> analizar; con `--strict-deps` aborta en vez de avisar.
>
> Ha hecho falta dos veces: los informes del 9 de agosto a las 14:56 y del 13 de
> agosto se generaron sin `openpyxl`, y el segundo llegó a producción con 341 XLSX
> archivados como «no analizados» cuando se habían descargado con HTTP 200 y no
> tenían nada malo.

## Volver a analizar solo lo que se quedó sin analizar

Si un informe ya publicado trae distribuciones sin analizar por una limitación
nuestra —falta un lector, se rompió el analizador, se cortó por el tope de
descarga—, no hace falta repetir el análisis completo:

```bash
# 1. Sembrar el checkpoint con lo que YA está bien analizado
npm run reports:seed -- --dry-run     # ver qué se reutiliza y qué se re-descarga
npm run reports:seed

# 2. Llevarse el checkpoint FUERA de la carpeta sincronizada (ver el aviso de abajo)
mkdir %TEMP%\jcyl-analysis
copy reports\current\analysis.checkpoint.jsonl %TEMP%\jcyl-analysis\checkpoint.jsonl

# 3. Analizar el catálogo completo: solo se descarga lo que falta
python -m src.analysis --limit 0 --workers 8 ^
  --checkpoint %TEMP%\jcyl-analysis\checkpoint.jsonl ^
  --output     %TEMP%\jcyl-analysis\bundle

# 4. Copiar el bundle verificado
del reports\current\d\*.json
copy %TEMP%\jcyl-analysis\bundle\d\*.json reports\current\d\
copy %TEMP%\jcyl-analysis\bundle\index.json reports\current\index.json
```

Funciona porque `run_analysis` indexa el checkpoint **por URL** y no por posición,
así que reutiliza cada resultado sembrado y solo descarga las URL que no están.
Después `aggregate()` recorre el conjunto entero y escribe un bundle coherente: no
hay que fusionar informes ni recalcular totales a mano.

`reports:seed` reconstruye cada resultado juntando `index.json` con su fragmento de
`d/<id>.json` —donde viven el esquema, las filas de muestra y las posiciones de cada
incidencia— y **verifica que la reconstrucción es exacta** volviendo a partirla y
comparándola con el original, por las dos mitades. Si algo no cuadra aborta sin
escribir nada, porque un checkpoint incompleto degradaría el informe en silencio.

El checkpoint (`reports/current/analysis.checkpoint.jsonl`, ~100 MB) está en
`.gitignore` y se puede borrar y regenerar cuando se quiera.

Sobre el informe del 13 de agosto: 1.292 resultados reutilizables y 366 a
re-analizar (341 XLSX, 24 SHP, 1 iCal), o sea **3 GB de descarga en vez de 23,5**.

## Avisos de operación

> [!CAUTION]
> **No uses `--legacy-output` para nada que vaya al repositorio.** Escribe el
> informe entero en un solo JSON de ~164 MB, por encima del límite de 100 MB por
> fichero de GitHub. `reports/history/` está en `.gitignore` por ese motivo.
>
> Al archivarlo el 14 de agosto quedó dentro de un commit y bloqueó el push
> entero; hubo que reescribir el commit, porque borrar el fichero después no
> sirve: el blob viaja igual dentro del commit que lo introdujo.

> [!WARNING]
> **Si el repositorio está en OneDrive (o Dropbox, o similar), ejecuta el análisis
> con `--checkpoint` y `--output` en disco local.** No es una precaución teórica:
> el 14 de agosto costó dos ejecuciones completas.
>
> - El checkpoint crece hasta ~130 MB y, dentro de la carpeta sincronizada, los
>   `append` empezaron a fallar con `OSError [Errno 22]`. El análisis siguió 45
>   minutos sin guardar nada.
> - Y al escribir el informe, `write_bundle` no pudo vaciar `reports/current/d`
>   porque el cliente de sincronización tenía el directorio abierto.
>
> Las dos cosas están mitigadas en el código —ahora el fallo del checkpoint se
> avisa en voz alta y el directorio de fragmentos se vacía sin borrarse— pero
> trabajar en disco local evita el problema de raíz.

## Formato del informe

El informe se escribe en `reports/current/` como un índice ligero más un fragmento
por distribución. Se guardan **todas** las ocurrencias de cada incidencia, no una
muestra: es lo que permite que el recuento del resumen y el detalle de la ficha
sean la misma cifra.

| Fichero | Qué lleva |
|---|---|
| `index.json` | Totales, desglose por formato y, por distribución, estado y recuento de cada incidencia |
| `d/<id>.json` | Todas las posiciones de cada incidencia, el esquema y filas de muestra |

`reports/current/` **se versiona**: es el artefacto de despliegue. Si no está en el
repositorio, el portal arranca sin datos.

El historial se retiró junto con la vista de evolución: el portal habla solo de la
última foto, así que `reports/current/` es lo único que tiene que viajar.

## Cómo llega al despliegue

```bash
export NEXT_PUBLIC_SITE_URL=https://cylmetrics.vercel.app
python -m src.analysis --limit 0   # escribe reports/current/
npm run build
```

Los ficheros del informe se leen con `fs` desde rutas que se construyen en tiempo de
ejecución, así que el rastreador de Next no las ve y hay que declararlas en
`outputFileTracingIncludes` (`next.config.ts`). Si se tocan las rutas, hay que tocar
también esa lista: sin ella el informe no viaja al despliegue, `/api/quality`
responde 503 y el portal se renderiza sin datos. En local no se nota, porque ahí los
ficheros están en disco.

Las rutas `/api/proxy` y `/api/ogc` declaran `maxDuration`; el valor sale de
`PLATFORM_MAX_DURATION_S` en `src/lib/download-budget.ts`, que es también de donde
se deriva el plazo del proxy. 60 s es el máximo del plan Hobby de Vercel.

## Rutas heredadas

`/gis`, `/transparencia`, `/alertas` y `/tendencias` son redirecciones 308 a la
pestaña correspondiente de `/calidad`, para que los enlaces antiguos sigan
funcionando. Las vistas anteriores de `/calidad` (`?vista=resumen`, `reparar`,
`incidencias`, `organismos`) también se mapean a las nuevas en `LEGACY_VISTAS`.
