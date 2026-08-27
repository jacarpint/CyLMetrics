"""Análisis de servicios OGC (WMS/WFS) vía GetCapabilities.

Particularidad de los endpoints del catálogo jcyl (GeoServer con
AdvancedDispatchFilter): las URLs llevan extensión .wms/.wfs y el servidor
redirige PERDIENDO el query string, por lo que sin request=GetCapabilities el
GeoServer responde "MissingParameterValue". Estrategia: seguir la redirección
manualmente y re-aplicar los parámetros a la URL final.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

from .tabular import _normalize

USER_AGENT = "CyLDataQualityPortal/1.0 (data-analysis)"
TIMEOUT = 20

VERSIONS = ("1.3.0", "1.1.1", "1.0.0")

REDIRECT_STATUSES = (301, 302, 303, 307, 308)


def _local(tag: str) -> str:
    return tag.split("}")[-1]


def _merge_params(url: str, service: str, version: str) -> str:
    """Añade service/request/version SOLO si faltan en el query.

    Los endpoints del catálogo a veces ya llevan params (p.ej. ArcGIS Server:
    WMSServer?request=getcapabilities&service=wms); duplicarlos rompe el
    servicio ("Can't parse XML request").
    """
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    params.setdefault("service", service)
    params.setdefault("request", "GetCapabilities")
    params.setdefault("version", version)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))


def _get_capabilities(url: str, service: str, version: str, timeout: int = TIMEOUT) -> requests.Response:
    """GetCapabilities siguiendo redirecciones SIN perder el query string.

    GeoServer (AdvancedDispatchFilter) redirige las URLs .wms/.wfs perdiendo el
    query; se re-aplican los parámetros a la URL final.
    """
    session = requests.Session()
    resp = session.get(
        _merge_params(url, service, version),
        allow_redirects=False, timeout=timeout,
        headers={"User-Agent": USER_AGENT},
    )
    if resp.status_code in REDIRECT_STATUSES:
        loc = resp.headers.get("Location", "")
        if loc:
            resp.close()
            resp = session.get(_merge_params(loc, service, version),
                               timeout=timeout, headers={"User-Agent": USER_AGENT})
    return resp


def _exception_note(root: ET.Element) -> str:
    """Extrae el texto de ServiceException / ows:Exception para diagnósticos."""
    for el in root.iter():
        if _local(el.tag) in ("ServiceException", "ExceptionText"):
            if (el.text or "").strip():
                return (el.text or "").strip()[:120]
    return ""


def analyze_ogc(url: str, ctx: dict) -> dict:
    service = ctx.get("declared_format", "WMS").upper()
    issues: list[dict] = []
    last_error = ""

    for version in VERSIONS:
        try:
            resp = _get_capabilities(url, service, version)
            if resp.status_code != 200:
                last_error = f"HTTP {resp.status_code}"
                resp.close()
                continue

            content = resp.content[:5_000_000]
            elapsed_ms = resp.elapsed.total_seconds() * 1000
            resp.close()
            head = content[:512].lstrip().lower()
            if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
                last_error = "la URL no apunta a un servicio OGC (devuelve una página HTML)"
                continue
            try:
                root = ET.fromstring(content)
            except ET.ParseError as exc:
                last_error = f"GetCapabilities no devuelve XML válido: {exc}"
                continue

            root_local = _local(root.tag)
            if "Capabilities" not in root_local:
                note = _exception_note(root)
                last_error = f"Raíz inesperada: {root_local}" + (f" ({note})" if note else "")
                continue

            if service == "WMS":
                layers = sum(1 for el in root.iter() if _local(el.tag) == "Layer")
                titles = [el.text for el in root.iter() if _local(el.tag) == "Title"][:3]
                score, ok = (100, True) if layers > 0 else (50, False)
                if layers == 0:
                    issues.append({"code": "sin-capas", "label": "GetCapabilities sin capas", "severity": "warning", "count": 1})
                # «Responde pero sin capas» no es «operativo».
                #
                # El resumen decía «WMS operativo: 0 capas detectadas» con
                # puntuación 50 y `ok=False`: un servicio que contesta un
                # GetCapabilities vacío no sirve para nada, y describirlo como
                # operativo contradice a su propia nota. Los 18 servicios del
                # catálogo declaran capas, así que no hay ningún caso publicado.
                summary = (
                    f"WMS operativo: {layers} capas detectadas (v{version})"
                    if layers > 0
                    else f"WMS responde pero no declara ninguna capa (v{version})"
                )
                metrics = {"service": "WMS", "version": version, "layers": layers, "titles": titles,
                           "http_status": 200, "duration_ms": elapsed_ms}
                return _normalize(None, ctx, ok, score, summary, metrics, issues)

            # WFS
            fts = sum(1 for el in root.iter() if _local(el.tag) == "FeatureType")
            score, ok = (100, True) if fts > 0 else (50, False)
            if fts == 0:
                issues.append({"code": "sin-feature-types", "label": "GetCapabilities sin FeatureTypes", "severity": "warning", "count": 1})
            summary = (
                f"WFS operativo: {fts} feature types (v{version})"
                if fts > 0
                else f"WFS responde pero no declara ningún feature type (v{version})"
            )
            metrics = {"service": "WFS", "version": version, "feature_types": fts,
                       "http_status": 200, "duration_ms": elapsed_ms}
            return _normalize(None, ctx, ok, score, summary, metrics, issues)
        except requests.RequestException as exc:
            last_error = f"No se pudo contactar el servicio: {type(exc).__name__}"
        except Exception as exc:
            last_error = f"Error inesperado: {exc}"

    return _normalize(None, ctx, False, 0,
                      f"{service} no disponible ({last_error})",
                      {"service": service, "requested_versions": list(VERSIONS)},
                      [{"code": "servicio-no-disponible", "label": last_error or "El servicio OGC no responde", "severity": "error", "count": 1}])
