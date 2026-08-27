"""Análisis de shapefiles empaquetados en ZIP (.shp/.dbf/.shx)."""
from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from .tabular import _normalize
from ..checks import missing_dependency_issue
from ..occurrences import add_row, new_issue

REQUIRED_EXTS = (".shp", ".dbf", ".shx")

#: Tope de lo que se escribe al descomprimir, por PROPORCIÓN y no por tamaño.
#:
#: Un ZIP declara lo que ocupa comprimido, no lo que ocupará descomprimido, y la
#: proporción no tiene techo: `zip-read.ts` documenta un caso comprobado de 299 KB
#: que se convierten en 300 MB, 1.029×. Aquí se extraía con `dst.write(src.read())`,
#: es decir el componente entero en memoria y en disco sin mirar cuánto era. El
#: lado TypeScript ya tenía tope y este no, así que media aplicación estaba
#: protegida y la otra mitad no.
#:
#: Se mide la proporción porque es lo que de verdad separa una bomba de un dato
#: grande. Un tope absoluto no sirve: los shapefiles del catálogo llegan a 648 MB
#: COMPRIMIDOS, y descomprimidos son varios gigas de `.dbf` legítimo. Con un tope
#: de 512 MB —el primero que puse— se habrían dejado de analizar los paquetes más
#: grandes de la comunidad, cambiando una vulnerabilidad teórica por la pérdida
#: real de datos que sí importan. Un factor de 50 deja holgura de sobra sobre lo
#: que comprime la geodata (2-15×) y queda veinte veces por debajo de la bomba
#: documentada.
INFLATE_RATIO = 50

#: Suelo, para que un ZIP diminuto no pueda inflarse «proporcionalmente».
#: Sin él, 10 KB × 50 daría 500 KB y ningún shapefile pequeño cabría.
MIN_INFLATED = 64 * 1024 * 1024  # 64 MB

#: Techo absoluto, por el disco. Ninguna capa de la comunidad se acerca.
MAX_INFLATED = 8 * 1024 * 1024 * 1024  # 8 GB

#: Trozo de lectura al descomprimir. Que no se lea el miembro de golpe es justo
#: lo que permite parar a tiempo.
CHUNK = 1024 * 1024


def _inflate_cap(zip_size: int) -> int:
    """Cuánto se permite escribir al descomprimir un paquete de `zip_size` bytes."""
    return min(MAX_INFLATED, max(MIN_INFLATED, zip_size * INFLATE_RATIO))


def analyze_zip_shapefile(path: Path, ctx: dict) -> dict:
    from ..checks import looks_like_html, read_ogc_exception

    # URLs que apuntan a un directorio/landing devuelven HTML, no un ZIP.
    if looks_like_html(path):
        return _normalize(path, ctx, False, 0,
                          "SHP: la URL apunta a un directorio/página web, no a un archivo descargable", {},
                          [{"code": "no-es-archivo",
                            "label": "El recurso SHP apunta a un directorio/página, no a un ZIP descargable",
                            "severity": "error", "count": 1}])

    # GeoServer contesta 200 con un informe de excepción cuando la capa que
    # pide la URL del catálogo ya no existe. Decir «ZIP inválido» ahí escondía
    # el motivo real, que es que el recurso publicado apunta a una capa muerta.
    exception = read_ogc_exception(path)
    if exception is not None:
        return _normalize(path, ctx, False, 0,
                          f"SHP: el servicio cartográfico devolvió un error en lugar del archivo ({exception})", {},
                          [{"code": "servicio-error",
                            "label": "El servicio de origen rechaza la petición del shapefile",
                            "severity": "error", "count": 1, "detail": exception}])

    if not zipfile.is_zipfile(path):
        # Un ZIP se valida por su final: si la descarga se cortó por el tope de
        # tamaño, el archivo de origen puede estar perfectamente y el fallo es
        # nuestro. Confundir las dos cosas culpaba al publicador sin motivo.
        if ctx.get("truncated"):
            return _normalize(path, ctx, False, 0,
                              "SHP: no se pudo comprobar el paquete porque la descarga se cortó por el tope de tamaño", {},
                              [{"code": "descarga-truncada",
                                "label": "El paquete no se pudo verificar: la descarga se cortó por tamaño",
                                "severity": "warning", "count": 1}])
        return _normalize(path, ctx, False, 0, "SHP: el archivo no es un ZIP válido", {}, [
            {"code": "zip-invalido", "label": "El paquete shapefile no es un ZIP válido", "severity": "error", "count": 1},
        ])

    try:
        import shapefile
    except ImportError:
        return _normalize(
            path, ctx, False, None,
            "No analizado: falta pyshp en el entorno de análisis",
            {}, [missing_dependency_issue("pyshp")],
        )

    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        lower = {n.lower() for n in names}
        missing = [ext for ext in REQUIRED_EXTS if not any(n.endswith(ext) for n in lower)]
        shp_name = next((n for n in names if n.lower().endswith(".shp")), None)
        if shp_name is None:
            return _normalize(path, ctx, False, 0, "SHP: no se encontró un archivo .shp dentro del ZIP", {}, [
                {"code": "shp-faltante", "label": "El ZIP no contiene un shapefile (.shp)", "severity": "error", "count": 1},
            ])

        # Extracción segura: sin zip-slip y con tope de tamaño descomprimido.
        tmp = Path(tempfile.mkdtemp(prefix="clyl-shp-"))
        escrito = 0
        tope = _inflate_cap(path.stat().st_size)
        try:
            for member in names:
                clean = Path(member)
                if clean.is_absolute() or ".." in clean.parts:
                    continue
                target = tmp / clean.name
                with zf.open(member) as src, open(target, "wb") as dst:
                    # A trozos, contando. `src.read()` a secas no puede pararse:
                    # cuando devuelve, el daño ya está hecho.
                    while True:
                        trozo = src.read(CHUNK)
                        if not trozo:
                            break
                        escrito += len(trozo)
                        if escrito > tope:
                            raise ValueError(
                                f"se descomprime por encima de {tope // (1024 * 1024)} MB, "
                                f"más de {INFLATE_RATIO} veces su tamaño comprimido"
                            )
                        dst.write(trozo)
        except ValueError as exc:
            # Se separa del resto: que un ZIP se infle sin medida no es un error
            # de lectura, y llamarlo así lo publicaría como archivo roto.
            return _normalize(path, ctx, False, None,
                              f"SHP: no se comprobó el paquete porque {exc}", {},
                              [{"code": "paquete-desproporcionado",
                                "label": "El paquete se descomprime muy por encima del tope y no se analiza",
                                "severity": "warning", "count": 1}])
        except Exception as exc:
            return _normalize(path, ctx, False, 0, f"SHP: error al extraer el ZIP: {exc}", {}, [
                {"code": "zip-extraccion", "label": "No se pudo extraer el shapefile", "severity": "error", "count": 1},
            ])

        try:
            reader = shapefile.Reader(str(tmp / Path(shp_name).name))
            try:
                feature_count = len(reader)
            except Exception:
                feature_count = -1

            # Geometrías nulas: TODAS, y con el número de registro de cada una.
            #
            # Antes se paraba a las 2.000 primeras (`NULL_GEOMETRY_SAMPLE`)
            # mientras `metrics.features` contaba el fichero entero: una capa de
            # 80.000 registros declaraba las geometrías vacías de las 2.000
            # primeras y la ficha lo presentaba como el total.
            null_geometry = new_issue("geometria-nula", "Registros con geometría vacía", "error")
            checked = 0
            for index, sh in enumerate(reader.iterShapes(), start=1):
                checked += 1
                if sh.shapeType == 0 or not getattr(sh, "points", None):
                    add_row(null_geometry, index)
            null_geoms = null_geometry["count"]

            fields = [f[0] for f in reader.fields if f[0] not in ("DeletionFlag",)]
            has_prj = any(n.lower().endswith(".prj") for n in lower)
            reader.close()
        except Exception as exc:
            return _normalize(path, ctx, False, 0, f"SHP: error al leer el shapefile: {exc}", {}, [
                {"code": "shp-lectura", "label": "El shapefile no se pudo leer", "severity": "error", "count": 1},
            ])

    issues: list[dict] = []
    score = 100
    for ext in missing:
        issues.append({
            "code": f"componente-faltante-{ext[1:]}",
            "label": f"Falta el componente {ext} del shapefile",
            "severity": "error" if ext == ".shp" else "warning",
            "count": 1,
        })
        if ext != ".shp":
            score -= 5
    if not has_prj:
        issues.append({"code": "sin-prj", "label": "El shapefile no incluye proyección (.prj)", "severity": "warning", "count": 1})
        score -= 5
    if null_geoms > 0:
        issues.append(null_geometry)
        score -= 15
    if feature_count == 0:
        issues.append({"code": "sin-features", "label": "El shapefile no contiene features", "severity": "error", "count": 1})
        score = 0

    # `ok` se deduce de las incidencias, que es lo único que puede decidirlo.
    #
    # Antes se fijaba a `True` doce líneas más arriba y no se volvía a tocar, así
    # que la rama `else` del resumen era inalcanzable: un shapefile sin features
    # se publicaba como «SHP válido: 0 features» con puntuación 0, diciendo dos
    # cosas contrarias en la misma ficha. No hay ningún caso en el informe actual
    # —de los 187 SHP del catálogo, 24 salen impecables y los otros 163 fallan en
    # ramas anteriores— pero solo porque ninguno llega aquí con defectos.
    ok = not any(issue["severity"] == "error" for issue in issues)
    features = f"{feature_count:,}" if feature_count >= 0 else "un número ilegible de"
    if ok:
        aviso = f", {len(issues)} aviso(s)" if issues else ""
        summary = (f"SHP válido: {features} features, {len(fields)} campos, "
                   f"proyección {'sí' if has_prj else 'no'}{aviso}")
    else:
        summary = f"SHP con problemas: {features} features, {len(missing)} componentes ausentes"
    return _normalize(path, ctx, ok, max(0, score), summary,
                      {"features": feature_count, "fields": len(fields), "field_names": fields,
                       "has_projection": has_prj, "missing_components": missing,
                       # Ya no es una muestra: se recorre el fichero entero, así
                       # que `null_geometry` y `features` se cuentan sobre la
                       # misma población y son comparables.
                       "null_geometry": null_geoms, "geometries_checked": checked},
                      issues)
