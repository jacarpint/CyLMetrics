"""Utilidades de bajo nivel compartidas por los analizadores."""
from __future__ import annotations

from pathlib import Path

MAGIC_ECW = b"ECW\x00"
MAGIC_JPEG = b"\xff\xd8\xff"


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
