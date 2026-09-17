"""Carga del catálogo RDF/XML (DCAT) y extracción de las distribuciones a auditar."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

RDF_CATALOG_URL = (
    "https://datosabiertos.jcyl.es/web/jcyl/risp/es/"
    "ciencia-tecnologia/general/1284166186527.rdf"
)
LOCAL_CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "rdf-catalog.rdf"

RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
DCAT = "{http://www.w3.org/ns/dcat#}"
DCT = "{http://purl.org/dc/terms/}"

# dct:IMT -> formato normalizado (idéntico a src/lib/types.ts)
IMT_TO_FORMAT = {
    "text/csv": "CSV",
    "application/json": "JSON",
    "application/geo+json": "GeoJSON",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/x-zipped-shp": "SHP",
    "application/xml": "XML",
    "application/rdf+xml": "RDF",
    "application/rss+xml": "RSS",
    "application/vnd.google-earth.kml+xml": "KML",
    "application/gml+xml": "GML",
    "text/wms": "WMS",
    "text/wfs": "WFS",
    "text/plain": "TXT",
    "image/jpeg": "JPEG",
    "text/calendar": "iCal",
    "application/ecw": "ECW",
    "application/octet-stream": "BIN",
}


def load_catalog_xml(input_path: str | None = None, url: str | None = None) -> tuple[bytes, str]:
    """Devuelve (xml_bytes, etiqueta_de_origen)."""
    if input_path:
        return Path(input_path).read_bytes(), f"file://{input_path}"
    target = url or RDF_CATALOG_URL
    req = Request(target, headers={"User-Agent": "CyLDataQualityPortal/1.0"})
    with urlopen(req, timeout=60) as resp:
        return resp.read(), target


_DESCRIPTION_RE = re.compile(r"<dct:description([^>]*)>(.*?)</dct:description>", re.DOTALL)


def sanitize_descriptions(xml_text: str) -> str:
    """Escapa el HTML suelto dentro de `dct:description`.

    Paridad con `sanitizeDescriptions` de `src/lib/rdf-catalog.ts`: algunas
    descripciones traen HTML sin escapar ni cerrar (`<ol>` pegado como texto
    plano). El parser lo da por etiqueta XML real y todo lo que sigue —licencia,
    tema, distribuciones— acaba colgando de `description`, así que el dataset se
    queda sin formatos. Pasó el 15 de septiembre de 2026 con «Estadísticas del
    impuesto sobre sucesiones y donaciones». Como `dct:description` no anida,
    basta con escapar `<`/`>` hasta su primer cierre literal.
    """
    return _DESCRIPTION_RE.sub(
        lambda m: f"<dct:description{m.group(1)}>"
        f"{m.group(2).replace('<', '&lt;').replace('>', '&gt;')}</dct:description>",
        xml_text,
    )


def iter_distributions(xml_bytes: bytes) -> list[dict]:
    """Devuelve la lista plana de distribuciones a auditar."""
    xml_text = xml_bytes.decode("utf-8", errors="replace") if isinstance(xml_bytes, bytes) else xml_bytes
    root = ET.fromstring(sanitize_descriptions(xml_text))
    items: list[dict] = []
    for ds_index, node in enumerate(root.findall(f".//{DCAT}Dataset")):
        title_el = node.find(f"{DCT}title")
        ds_id = node.get(f"{RDF}about", "")
        ds_title = (title_el.text or "").strip() if title_el is not None else ""
        for dist in node.findall(f"{DCAT}distribution/{DCAT}Distribution"):
            imt = dist.find(f".//{DCT}IMT")
            mime = (imt.get(f"{RDF}value") or "").strip() if imt is not None else ""
            fmt = IMT_TO_FORMAT.get(mime.lower(), "OTRO")
            url_el = dist.find(f"{DCAT}accessURL")
            url = ""
            if url_el is not None:
                # Soporta ambas formas: rdf:resource="URL" y >URL</dcat:accessURL>
                url = (url_el.get(f"{RDF}resource") or url_el.text or "").strip()
            if not url:
                # Y una tercera: la URL en el `rdf:about` del propio nodo
                # `Distribution`, sin `dcat:accessURL` ninguno.
                #
                # Son 12 distribuciones del catálogo —presas con plan de
                # emergencia, establecimientos Seveso, riesgo de inundaciones— y
                # se archivaban como «el catálogo describe el recurso pero no
                # publica ninguna URL de acceso», que era falso: la URL está, en
                # otro sitio. El parser del portal (`rdf-catalog.ts`) ya hacía
                # este mismo respaldo, así que las dos mitades del proyecto
                # discrepaban: la web las contaba y las enlazaba mientras el
                # análisis ni las intentaba.
                url = (dist.get(f"{RDF}about") or "").strip()
            items.append(
                {
                    "dataset_index": ds_index,
                    "dataset_id": ds_id,
                    "dataset_title": ds_title,
                    "format": fmt,
                    "mime": mime,
                    "url": url,
                }
            )
    return items
