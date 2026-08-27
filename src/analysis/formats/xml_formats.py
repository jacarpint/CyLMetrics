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
           extra_metrics: dict | None = None, recovered: str | None = None,
           root: ET.Element | None = None) -> dict:
    """
    Resultado común de los formatos XML, a partir de un documento YA parseado.

    `root` llega de fuera a propósito. Antes esta función hacía su propio
    `_parse(path)`, y todos los que la llaman ya habían parseado el fichero para
    poder contar sus entidades: cada XML, RSS, KML, RDF y GML del catálogo se
    parseaba DOS VECES, con el doble de tiempo y de memoria y sin que la segunda
    pasada aportara nada. De paso, ese `_parse` interno reasignaba `recovered` y
    dejaba muerto el parámetro del mismo nombre que le pasaban.
    """
    if root is None:
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
        # Severidad `error`, no `warning`, para que la etiqueta case con lo que se
        # hace después: puntuación 0.
        #
        # `sin-entidades` no está en `BLOCKING_ISSUE_CODES`, así que el archivo
        # cuenta como entregado y ese 0 SÍ entra en la media de calidad de
        # contenido del conjunto. Pero la tabla de archivos corregibles de
        # `/calidad` se construye filtrando `severity === 'error'`, de modo que
        # con `warning` el archivo quedaba penalizado en la media y a la vez
        # invisible en la lista de lo que hay que arreglar. Sus dos equivalentes
        # exactos —`sin-datos` en Excel y `sin-features` en shapefile, ambos con
        # puntuación 0— ya son `error`.
        issues.append({"code": "sin-entidades", "label": f"No se detectaron {count_label}", "severity": "error", "count": 1})
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
    return _basic(path, ctx, "RSS", "items", items, {"channel": bool(_count_by_local(root, "channel"))},
                  recovered=recovered, root=root)


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
                  {"points": points, "root_local": "kml"}, recovered=recovered, root=root)


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
                  recovered=recovered, root=root)


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
    if members == 0:
        # `wfs:member`, el nombre que usan GML 3.2 y WFS 2.0.
        #
        # `featureMember`/`featureMembers` son de GML 3.1 y WFS 1.1, así que un
        # GML exportado por un servicio moderno contaba CERO miembros y `_basic`
        # lo publicaba con puntuación 0 y «sin features detectados» — un archivo
        # correcto acusado de venir vacío. No hay ningún caso hoy porque las 30
        # distribuciones GML del catálogo fallan antes, en la descarga, pero es
        # la versión del estándar hacia la que van los servicios.
        #
        # Solo si las otras dos dan cero, para no alterar los recuentos de los
        # documentos que sí usan la forma antigua.
        members = _count_by_local(root, "member")
    return _basic(path, ctx, "GML", "features", members, {"geometries": geometries},
                  recovered=recovered, root=root)
