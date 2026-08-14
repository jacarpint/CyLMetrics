"""Utilidades de bajo nivel compartidas por los analizadores."""
from __future__ import annotations

import re
from pathlib import Path

MAGIC_ECW = b"ECW\x00"
MAGIC_JPEG = b"\xff\xd8\xff"

#: Códigos que hablan del portal, no del archivo analizado.
#:
#: Falta una librería de lectura, se agotó nuestro tope de descarga, se rompió
#: nuestro propio analizador: en los tres casos el archivo puede estar
#: perfectamente y lo único que sabemos es que no lo hemos comprobado. No pueden
#: contarse como error del dataset ni entrar en las medias de calidad.
#:
#: Tiene que decir lo mismo que `PORTAL_LIMITATION_CODES` en
#: `src/lib/quality-labels.ts`; hay un test que compara las dos listas, porque la
#: sincronización entre los analizadores y las tablas de la interfaz es manual.
#:
#: Deliberadamente fuera: `no-es-archivo` y `no-es-imagen`. Que la URL publicada
#: devuelva una página web en vez del archivo es un defecto de publicación, no una
#: limitación nuestra, aunque `engine.py` los degrade a «omitida» junto a estos.
PORTAL_LIMITATION_CODES = frozenset({
    "dependencia-faltante",
    "fallo-analizador",
    "error-validacion",
    "descarga-truncada",
    "too_large",
})

#: Códigos en los que la URL publicada no devuelve el archivo que promete.
#:
#: No son limitaciones nuestras —el enlace del catálogo apunta a una página web en
#: vez de al dato— pero tampoco se penalizan como error del contenido: el fallo
#: está en la plataforma de publicación y la interfaz les da un estado propio.
#: Es el mismo conjunto que `NOT_A_FILE_CODES` en `src/lib/availability.ts`, y el
#: test de paridad comprueba los dos.
PUBLICATION_DEFECT_CODES = frozenset({
    "no-es-archivo",
    "no-es-imagen",
})


def missing_dependency_issue(package: str) -> dict:
    """
    La incidencia de «nos falta el lector», con la severidad correcta.

    Estaba escrita a mano en cinco analizadores con `severity: "error"`, y eso
    llegaba a la interfaz como un error del archivo: en el informe del 13 de
    agosto, 364 archivos —341 XLSX sin openpyxl— aparecían como defectuosos
    cuando se habían descargado completos y con HTTP 200. La severidad es `info`
    porque no hay nada que arreglar en el dato: hay que instalar la dependencia
    en el entorno que ejecuta el análisis.
    """
    # Vía `simple_issue` para no volver a escribir a mano la forma de una
    # incidencia ya cerrada: es quien decide que `stored` va a 0.
    from .occurrences import simple_issue

    return simple_issue("dependencia-faltante", f"{package} no disponible", "info")


def sniff_magic(path: Path, n: int = 1024) -> bytes:
    with open(path, "rb") as fh:
        return fh.read(n)


def is_ecw(path: Path) -> bool:
    return sniff_magic(path, 4) == MAGIC_ECW


def is_jpeg(path: Path) -> bool:
    return sniff_magic(path, 3) == MAGIC_JPEG


def looks_like_html(path: Path) -> bool:
    """True si el inicio del archivo parece una página HTML (directorio/landing)."""
    try:
        head = path.read_bytes()[:512].lstrip().lower()
    except Exception:
        return False
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def read_ogc_exception(path: Path) -> str | None:
    """
    Texto del error si el archivo es un informe de excepción OGC.

    Varias distribuciones del catálogo apuntan a un GetFeature de GeoServer que
    responde HTTP 200 con un `ExceptionReport` diciendo que la capa ya no
    existe. Sin mirar dentro, eso se confundía con un archivo corrupto.
    """
    try:
        head = path.read_bytes()[:8192]
    except Exception:
        return None
    if b"ExceptionReport" not in head and b"ServiceException" not in head:
        return None

    text = head.decode("utf-8", errors="replace")
    match = re.search(r"<(?:\w+:)?ExceptionText[^>]*>(.*?)</(?:\w+:)?ExceptionText>", text, re.S)
    if match is None:
        match = re.search(
            r"<(?:\w+:)?ServiceException(?![A-Za-z])[^>]*>(.*?)</(?:\w+:)?ServiceException>", text, re.S
        )
    if match is None:
        return "El servicio devolvió un error sin descripción"
    return " ".join(match.group(1).split())


def detect_encoding(data: bytes, default: str = "utf-8") -> str:
    """Detección de encoding con charset-normalizer (fallback a latin-1)."""
    try:
        from charset_normalizer import from_bytes

        best = from_bytes(data[:1_000_000]).best()
        if best is not None and best.encoding:
            return best.encoding
    except Exception:
        pass
    for enc in (default, "utf-8", "latin-1"):
        try:
            data[:64].decode(enc)
            return enc
        except Exception:
            continue
    return default


def guess_delimiter(sample: str) -> str:
    """Detecta el delimitador de un CSV (; , o tabulador)."""
    import csv

    try:
        dialect = csv.Sniffer().sniff(sample[:4096], delimiters=";,\t|")
        return dialect.delimiter
    except Exception:
        counts = {d: sample.count(d) for d in (";", ",", "\t", "|")}
        best = max(counts, key=counts.get)
        return best if counts[best] > 0 else ","
