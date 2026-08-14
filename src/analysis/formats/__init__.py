"""Registro de analizadores por formato.

Cada analizador recibe (path, ctx) y devuelve un dict normalizado:
  {"ok": bool, "score": int | None, "summary": str, "metrics": dict, "issues": list[Issue]}
  Issue: {"code", "label", "severity": "error"|"warning"|"info", "count"}

`score` es None cuando el análisis no llegó a medir nada (por ejemplo, falta la
librería de lectura): un 0 significaría «medido y malo» y contaminaría las medias.
`severity: "info"` es para las incidencias que hablan del portal y no del archivo.
"""
from __future__ import annotations

from .tabular import analyze_csv, analyze_json, analyze_txt
from .excel import analyze_xlsx
from .shapefile import analyze_zip_shapefile
from .xml_formats import analyze_rss, analyze_xml_generic, analyze_kml, analyze_rdf, analyze_gml
from .ogc import analyze_ogc
from .geo import analyze_geojson
from .images import analyze_jpeg, analyze_ecw
from .binary import analyze_binary
from .ical import analyze_ical

REGISTRY = {
    "CSV": lambda path, ctx: analyze_csv(path, ctx),
    "TXT": lambda path, ctx: analyze_txt(path, ctx),
    "JSON": lambda path, ctx: analyze_json(path, ctx),
    "GeoJSON": lambda path, ctx: analyze_geojson(path, ctx),
    "XLSX": lambda path, ctx: analyze_xlsx(path, ctx),
    "SHP": lambda path, ctx: analyze_zip_shapefile(path, ctx),
    "XML": lambda path, ctx: analyze_xml_generic(path, ctx),
    "RDF": lambda path, ctx: analyze_rdf(path, ctx),
    "RSS": lambda path, ctx: analyze_rss(path, ctx),
    "KML": lambda path, ctx: analyze_kml(path, ctx),
    "GML": lambda path, ctx: analyze_gml(path, ctx),
    "WMS": lambda path, ctx: analyze_ogc(path, ctx),
    "WFS": lambda path, ctx: analyze_ogc(path, ctx),
    "JPEG": lambda path, ctx: analyze_jpeg(path, ctx),
    "ECW": lambda path, ctx: analyze_ecw(path, ctx),
    "iCal": lambda path, ctx: analyze_ical(path, ctx),
    "BIN": lambda path, ctx: analyze_binary(path, ctx),
    "OTRO": lambda path, ctx: analyze_binary(path, ctx),
}

#: Librería de lectura que necesita cada formato, y qué se queda sin comprobar si
#: falta.
#:
#: Existe para poder avisar ANTES de empezar. Sin esto, una ejecución en un entorno
#: sin `openpyxl` se completaba entera, tardaba horas, y solo al mirar el informe
#: se veía que 341 XLSX se habían archivado como «no analizados» — o peor, se
#: publicaba sin que nadie lo mirase. Ha pasado ya dos veces: el informe del 9 de
#: agosto a las 14:56 y el del 13 de agosto.
#:
#: Tiene que cubrir TODOS los formatos de `REGISTRY`, no solo los que fallaron esa
#: vez. `frictionless` es el caso que más importa y el que se quedó fuera en la
#: primera versión de esta tabla: es el validador de CSV, TXT y JSON, o sea los dos
#: grupos de formatos más numerosos del catálogo (casi 1.000 de 1.658
#: distribuciones). Si el que falta la próxima vez es ese, sin esta entrada el
#: accidente se repite igual.
#:
#: `charset-normalizer` y `fast-xml-parser` no entran: los analizadores que los
#: usan degradan a una heurística razonable en vez de dejar de comprobar.
READER_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "frictionless": ("CSV", "TXT", "JSON"),
    "openpyxl": ("XLSX",),
    "shapefile": ("SHP",),
    "icalendar": ("iCal",),
    "geojson": ("GeoJSON",),
    "PIL": ("JPEG",),
    "filetype": ("BIN", "OTRO"),
}


def missing_readers(only_formats: set[str] | None = None) -> dict[str, tuple[str, ...]]:
    """
    Las librerías de lectura que no se pueden importar, con sus formatos.

    Se comprueba importando de verdad y no con `importlib.util.find_spec`: una
    dependencia a medio instalar aparece como encontrada y falla al usarla, que es
    justo el caso que hay que detectar.

    `only_formats` acota la comprobación a los formatos que se van a analizar, y no
    es solo cosmético: importar los seis lectores tarda unos cientos de milisegundos
    —Pillow y openpyxl son los lentos—, así que una ejecución `--only-formats CSV`
    los cargaba todos para nada y encima avisaba de formatos que no iba a tocar.
    Los formatos se comparan en mayúsculas, como hace la propia CLI.
    """
    import importlib

    wanted = {f.upper() for f in only_formats} if only_formats else None
    missing: dict[str, tuple[str, ...]] = {}
    for module, formats in READER_REQUIREMENTS.items():
        afectados = (
            formats if wanted is None else tuple(f for f in formats if f.upper() in wanted)
        )
        if not afectados:
            continue
        try:
            importlib.import_module(module)
        except Exception:
            missing[module] = afectados
    return missing
