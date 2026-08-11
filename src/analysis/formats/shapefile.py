"""Análisis de shapefiles empaquetados en ZIP (.shp/.dbf/.shx)."""
from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

from .tabular import _normalize

REQUIRED_EXTS = (".shp", ".dbf", ".shx")
NULL_GEOMETRY_SAMPLE = 2000


def analyze_zip_shapefile(path: Path, ctx: dict) -> dict:
    from ..checks import looks_like_html

    # URLs que apuntan a un directorio/landing devuelven HTML, no un ZIP.
    if looks_like_html(path):
        return _normalize(path, ctx, False, 0,
                          "SHP: la URL apunta a un directorio/página web, no a un archivo descargable", {},
                          [{"code": "no-es-archivo",
                            "label": "El recurso SHP apunta a un directorio/página, no a un ZIP descargable",
                            "severity": "error", "count": 1}])

    if not zipfile.is_zipfile(path):
        return _normalize(path, ctx, False, 0, "SHP: el archivo no es un ZIP válido", {}, [
            {"code": "zip-invalido", "label": "El paquete shapefile no es un ZIP válido", "severity": "error", "count": 1},
        ])

    try:
        import shapefile
    except ImportError:
        return _normalize(path, ctx, False, 0, "pyshp no está instalado", {}, [
            {"code": "dependencia-faltante", "label": "pyshp no disponible", "severity": "error", "count": 1},
        ])

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

            # Muestra de geometrías nulas (sin abrir el shape completo)
            null_geoms = 0
            checked = 0
            for sh in reader.iterShapes():
                checked += 1
                if sh.shapeType == 0 or not getattr(sh, "points", None):
                    null_geoms += 1
                if checked >= NULL_GEOMETRY_SAMPLE:
                    break

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
        issues.append({"code": "geometria-nula", "label": "Registros con geometría vacía", "severity": "error", "count": null_geoms})
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
                      {"features": feature_count, "fields": len(fields), "field_names": fields[:20],
                       "has_projection": has_prj, "missing_components": missing,
                       "null_geometry_sample": null_geoms},
                      issues)
