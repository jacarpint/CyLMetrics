"""Análisis de shapefiles empaquetados en ZIP (.shp/.dbf/.shx)."""
from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from .tabular import _normalize
from ..checks import missing_dependency_issue
from ..occurrences import add_row, new_issue

REQUIRED_EXTS = (".shp", ".dbf", ".shx")


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

        # Extracción segura (evita zip-slip)
        tmp = Path(tempfile.mkdtemp(prefix="clyl-shp-"))
        try:
            for member in names:
                clean = Path(member)
                if clean.is_absolute() or ".." in clean.parts:
                    continue
                target = tmp / clean.name
                with zf.open(member) as src, open(target, "wb") as dst:
                    dst.write(src.read())
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
    score, ok = 100, True
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

    summary = (
        f"SHP válido: {feature_count:,} features, {len(fields)} campos, proyección {'sí' if has_prj else 'no'}"
        if ok
        else f"SHP con problemas: {feature_count:,} features, {len(missing)} componentes ausentes"
    )
    return _normalize(path, ctx, ok, max(0, score), summary,
                      {"features": feature_count, "fields": len(fields), "field_names": fields,
                       "has_projection": has_prj, "missing_components": missing,
                       # Ya no es una muestra: se recorre el fichero entero, así
                       # que `null_geometry` y `features` se cuentan sobre la
                       # misma población y son comparables.
                       "null_geometry": null_geoms, "geometries_checked": checked},
                      issues)
