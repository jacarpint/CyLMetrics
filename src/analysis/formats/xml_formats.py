"""Análisis de formatos XML: XML genérico, RDF, RSS, KML y GML."""
from __future__ import annotations

import re
from pathlib import Path
import xml.etree.ElementTree as ET

from ..checks import detect_encoding
from .tabular import _normalize

KML_NS = "{http://www.opengis.net/kml/2.2}"
GML_NS = "{http://www.opengis.net/gml}"

# & "sueltos" (no seguidos de una entidad válida o referencia numérica)
_AMP_RE = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)")


def _parse(path: Path) -> tuple[ET.Element | None, str, str | None]:
    """Devuelve (root, error, nota_reparacion).

    Si el XML no es bien formado se reintenta de forma tolerante: decodificando
    con la codificación real detectada (bytes inválidos -> reemplazados),
    escapando entidades sueltas ('Diseño & Publicidad') y eliminando caracteres
    de control prohibidos en XML 1.0. `nota_reparacion` describe qué se reparó.
    """
    try:
        return ET.parse(path).getroot(), "", None
    except ET.ParseError as exc:
        try:
            raw = path.read_bytes()
            enc = detect_encoding(raw[:1_000_000])
            text = raw.decode(enc, errors="replace")
            fixed_amp = bool(_AMP_RE.search(text))
            if fixed_amp:
                text = _AMP_RE.sub("&amp;", text)
            # Caracteres de control no permitidos en XML 1.0 (solo \t \n \r):
            # se decodifican sin error pero rompen el parser.
            text = "".join(ch for ch in text if ch in "\t\n\r" or ch >= " ")
            root = ET.fromstring(text.encode("utf-8"))
            note = f"XML reparado: codificación {enc}"
            if fixed_amp:
                note += ", entidades sin escapar (&) corregidas"
            return root, "", note
        except Exception:
            return None, f"XML no bien formado: {exc}", None
    except Exception as exc:
        return None, f"Error al leer XML: {exc}", None


def _encoding_issue(note: str | None) -> list[dict]:
    if not note:
        return []
    return [{
        "code": "xml-reparado",
        "label": note,
        "severity": "warning",
        "count": 1,
    }]


def _count_by_local(root: ET.Element, local: str) -> int:
    return sum(1 for el in root.iter() if el.tag.split('}')[-1] == local)


def _basic(path: Path, ctx: dict, kind: str, count_label: str, count: int,
           extra_metrics: dict | None = None, recovered: str | None = None) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"{kind}: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    issues = _encoding_issue(recovered)
    total_elements = sum(1 for _ in root.iter())
    metrics = {"root": root.tag, "total_elements": total_elements, count_label: count}
    if extra_metrics:
        metrics.update(extra_metrics)
    if count == 0:
        issues.append({"code": "sin-entidades", "label": f"No se detectaron {count_label}", "severity": "warning", "count": 1})
        return _normalize(path, ctx, False, 0,
                          f"{kind} válido pero sin {count_label} detectados", metrics, issues)
    return _normalize(path, ctx, True, 100, f"{kind} válido: {count:,} {count_label}", metrics, issues)


def analyze_xml_generic(path: Path, ctx: dict) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"XML: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    issues = _encoding_issue(recovered)
    total = sum(1 for _ in root.iter())
    return _normalize(path, ctx, True, 100,
                      f"XML bien formado: {total:,} elementos, raíz '{root.tag.split('}')[-1]}'",
                      {"root": root.tag, "total_elements": total, "root_local": root.tag.split('}')[-1]}, issues)


def analyze_rss(path: Path, ctx: dict) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"RSS: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    items = _count_by_local(root, "item")
    return _basic(path, ctx, "RSS", "items", items, {"channel": bool(_count_by_local(root, "channel"))}, recovered=recovered)


def analyze_kml(path: Path, ctx: dict) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"KML: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    placemarks = _count_by_local(root, "Placemark")
    points = _count_by_local(root, "Point")
    if root.tag != f"{KML_NS}kml":
        return _normalize(path, ctx, False, 0,
                          f"KML: la raíz no es <kml> (es '{root.tag.split('}')[-1]}')", {},
                          [{"code": "raiz-invalida", "label": "La raíz del documento no es <kml>", "severity": "error", "count": 1}])
    return _basic(path, ctx, "KML", "placemarks", placemarks,
                  {"points": points, "root_local": "kml"}, recovered=recovered)


def analyze_rdf(path: Path, ctx: dict) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"RDF: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    # Entidades RDF: rdf:Description en RDF/XML clásico, o elementos DCAT
    # (Catalog/Dataset/Distribution) cuando el catálogo exporta el RDF por niveles.
    descriptions = _count_by_local(root, "Description")
    dcat_datasets = _count_by_local(root, "Dataset")
    distributions = _count_by_local(root, "Distribution")
    catalogs = _count_by_local(root, "Catalog")
    entities = descriptions + dcat_datasets + distributions + catalogs
    return _basic(path, ctx, "RDF", "entidades", entities,
                  {"descripciones": descriptions, "dcat_datasets": dcat_datasets,
                   "dcat_distributions": distributions, "dcat_catalogs": catalogs},
                  recovered=recovered)


def analyze_gml(path: Path, ctx: dict) -> dict:
    root, err, recovered = _parse(path)
    if err:
        return _normalize(path, ctx, False, 0, f"GML: {err}", {}, [
            {"code": "xml-no-bien-formado", "label": err, "severity": "error", "count": 1},
        ])
    # Cuenta elementos con geometría gml (Point, LineString, Polygon, ...) y miembros
    geometries = sum(
        1 for el in root.iter()
        if el.tag.split('}')[-1] in ("Point", "LineString", "Polygon", "MultiPoint",
                                     "MultiLineString", "MultiPolygon", "MultiGeometry")
    )
    members = _count_by_local(root, "featureMember") + _count_by_local(root, "featureMembers")
    return _basic(path, ctx, "GML", "features", members, {"geometries": geometries}, recovered=recovered)
