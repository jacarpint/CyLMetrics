"""Registro de analizadores por formato.

Cada analizador recibe (path, ctx) y devuelve un dict normalizado:
  {"ok": bool, "score": int, "summary": str, "metrics": dict, "issues": list[Issue]}
  Issue: {"code", "label", "severity": "error"|"warning", "count"}
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
