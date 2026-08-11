"""Carga del catálogo RDF/XML (DCAT) y extracción de las distribuciones a auditar."""
from __future__ import annotations

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


def iter_distributions(xml_bytes: bytes) -> list[dict]:
    """Devuelve la lista plana de distribuciones a auditar."""
    root = ET.fromstring(xml_bytes)
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
