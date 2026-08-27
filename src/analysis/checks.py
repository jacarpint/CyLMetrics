"""Utilidades de bajo nivel compartidas por los analizadores."""
from __future__ import annotations

import codecs
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
    # Nuestro tope de descompresión, no un defecto del paquete: puede estar
    # perfecto y lo único que sabemos es que no lo hemos abierto.
    "paquete-desproporcionado",
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

#: Códigos con los que el archivo directamente no se puede abrir.
#:
#: Un JSON inválido, un ZIP corrupto, un shapefile al que le faltan piezas: no hay
#: contenido que medir, así que su nota NO puede entrar en la media de calidad de
#: contenido del conjunto de datos. Es distinto de «abre pero viene sucio», que sí
#: entra y es lo que ese eje mide.
#:
#: Tiene que decir lo mismo que `BLOCKING_ISSUE_CODES` en `src/lib/alerts.ts`, que
#: es donde lo consume `classifyDelivery`; el test de paridad compara las dos.
BLOCKING_ISSUE_CODES = frozenset({
    "descarga",
    "error-fuente",
    "no-es-archivo",
    "archivo-vacio",
    "servicio-no-disponible",
    "servicio-error",
    "no-es-imagen",
    "formato-no-esperado",
    "json-invalido",
    "xml-no-bien-formado",
    "xlsx-invalido",
    "zip-invalido",
    "tipo-no-identificado",
    "error-validacion",
    "error-esquema",
    "ical-invalido",
    "firma-invalida",
    "geojson-invalido",
    "raiz-invalida",
    "imagen-corrupta",
    "shp-faltante",
    "zip-extraccion",
    "shp-lectura",
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


#: Codificaciones que puede tener de verdad un archivo de este catálogo.
#:
#: La lista no es una preferencia de estilo: sin ella el analizador publicaba
#: texto corrompido. `charset-normalizer` elige entre las ~90 codificaciones que
#: conoce Python, y para un CSV castellano típico —«Peñafiel», «León»— prefería
#: **cp1250**, la centroeuropea. cp1250 y cp1252 coinciden en ó, á, í, ú… y solo
#: discrepan en unos pocos bytes, entre ellos el 0xF1: en cp1252 es «ñ» y en
#: cp1250 es «ń». Como las dos lecturas son válidas, la puntuación heurística
#: las ve casi igual de bien y desempata mal.
#:
#: El daño no se veía porque no produce U+FFFD sino un carácter legítimo. En el
#: informe publicado con la detección abierta: 259 distribuciones leídas como
#: cp1250 y 156 fragmentos con caracteres imposibles en castellano (ń, ż, ř),
#: además de detecciones sin sentido para el catálogo de una comunidad autónoma
#: —shift_jis_2004, cp932, mac_iceland, cp775—. O sea, el portal que audita la
#: calidad de los datos publicaba «Peńafiel» en sus propias filas de muestra.
#:
#: Se acota por eso a lo que un organismo de Castilla y León puede llegar a
#: exportar: UTF-8 (con y sin BOM), Windows-1252 y sus dos ISO equivalentes,
#: UTF-16 —lo que suelta Excel al «guardar como texto Unicode»— y cp850, la del
#: `chcp` por defecto de una consola de Windows en español.
PLAUSIBLE_ENCODINGS = [
    "utf_8",
    "utf_8_sig",
    "cp1252",
    "iso8859_1",
    "iso8859_15",
    "ascii",
    "utf_16",
    "utf_16_le",
    "utf_16_be",
    "cp850",
]


def _es_utf8(data: bytes) -> bool:
    """
    ¿Es UTF-8 con al menos un carácter multibyte?

    Se pide el carácter multibyte porque un archivo solo-ASCII decodifica bien en
    todas las candidatas: ahí no hay nada que decidir y contestar «utf-8» sería
    correcto pero inútil, así que se deja pasar a la heurística.

    Tolera que el último carácter esté partido —de ahí el decodificador
    incremental con `final=False`, que se guarda los bytes sueltos del final en
    vez de protestar—. El analizador trabaja con descargas que `--size-cap`
    recorta, y el corte cae donde cae: sin esta holgura, un archivo cuya trama
    terminase en mitad de una «ñ» se descartaría como «no es UTF-8» por culpa de
    un byte que ni siquiera es suyo. La holgura llega hasta tres bytes al final y
    no debilita nada: todo lo anterior tiene que ser UTF-8 impecable.
    """
    muestra = data[:1_000_000]
    if muestra.isascii():
        return False
    try:
        codecs.getincrementaldecoder("utf-8")().decode(muestra, final=False)
    except UnicodeDecodeError:
        return False
    return True


def detect_encoding(data: bytes, default: str = "utf-8") -> str:
    """Detección de encoding acotada a las codificaciones plausibles del catálogo."""
    # El BOM es una declaración explícita del que escribió el archivo: si está,
    # no hay nada que adivinar. Va antes que la heurística porque `utf_8` a secas
    # deja el BOM dentro del texto y se cuela como parte del primer nombre de
    # columna («﻿municipio»).
    for bom, enc in (
        (b"\xef\xbb\xbf", "utf_8_sig"),
        (b"\xff\xfe\x00\x00", "utf_32_le"),
        (b"\x00\x00\xfe\xff", "utf_32_be"),
        (b"\xff\xfe", "utf_16_le"),
        (b"\xfe\xff", "utf_16_be"),
    ):
        if data.startswith(bom):
            return enc

    # UTF-8 antes que cualquier heurística, porque no es una heurística.
    #
    # UTF-8 se autovalida por diseño: sus secuencias multibyte siguen un patrón
    # que una tira de bytes en otra codificación no cumple por casualidad más que
    # con probabilidad ínfima. Si el archivo entero decodifica limpio y contiene
    # al menos una de esas secuencias, no hay nada que sopesar.
    #
    # Y hace falta ponerlo por delante: con 164 bytes casi todos ASCII y una sola
    # «ñ», `charset-normalizer` devolvía cp1252 —una lectura también válida, byte
    # a byte— y publicaba «Ã±». La detección estadística necesita volumen para
    # desempatar, y un archivo con dos acentos no se lo da.
    if _es_utf8(data):
        return "utf-8"

    try:
        from charset_normalizer import from_bytes

        best = from_bytes(data[:1_000_000], cp_isolation=PLAUSIBLE_ENCODINGS).best()
        if best is not None and best.encoding:
            return best.encoding
    except Exception:
        pass

    # Respaldo por si `charset-normalizer` no está o no se decide.
    #
    # Se prueba sobre el buffer entero y no sobre los primeros 64 bytes: cortar a
    # ciegas parte por la mitad cualquier carácter multibyte que caiga en la
    # frontera, y entonces un UTF-8 perfectamente válido fallaba el intento y se
    # archivaba como latin-1. El orden importa —latin-1 decodifica CUALQUIER
    # secuencia de bytes sin protestar, así que solo vale como último recurso.
    muestra = data[:1_000_000]
    for enc in (default, "utf-8", "latin-1"):
        try:
            muestra.decode(enc)
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
