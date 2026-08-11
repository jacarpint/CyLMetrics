"""Análisis de archivos binarios genéricos (BIN/OTRO): firma y tipo real."""
from __future__ import annotations

from pathlib import Path

from ..checks import is_ecw, is_jpeg, looks_like_html, sniff_magic
from .tabular import _normalize


def analyze_binary(path: Path, ctx: dict) -> dict:
    declared = ctx.get("declared_format", "BIN")
    size = path.stat().st_size
    magic = sniff_magic(path, 1024)
    detected = None
    try:
        import filetype

        guess = filetype.guess(magic)
        if guess is not None:
            detected = {"extension": guess.extension, "mime": guess.mime}
    except ImportError:
        pass

    if detected is None and looks_like_html(path):
        detected = {"extension": "html", "mime": "text/html", "html": True}

    issues: list[dict] = []
    if detected is None:
        # Heurísticas básicas de firma
        if is_jpeg(path):
            detected = {"extension": "jpg", "mime": "image/jpeg"}
        elif is_ecw(path):
            detected = {"extension": "ecw", "mime": "application/ecw"}
        elif magic[:4] == b"PK\x03\x04":
            detected = {"extension": "zip", "mime": "application/zip"}
        elif magic[:5] in (b"<?xml", b"{\"", b"[{\""):
            detected = {"extension": "xml/json", "mime": "text/xml|application/json"}

    if detected:
        if detected.get("html"):
            summary = f"Archivo binario ({declared}) es una página HTML (directorio/landing), {size/1e6:.2f} MB"
            issues.append({
                "code": "no-es-archivo",
                "label": "El contenido descargado es HTML, no el tipo declarado",
                "severity": "error",
                "count": 1,
            })
            return _normalize(path, ctx, False, 0, summary,
                              {"size_bytes": size, "detected": detected, "declared": declared}, issues)
        summary = f"Archivo binario ({declared}) identificado como {detected['extension']} ({detected['mime']}), {size/1e6:.2f} MB"
        if declared in ("BIN", "OTRO"):
            issues.append({
                "code": "tipo-detectado",
                "label": f"El contenido real parece ser {detected['extension']}, no {declared}",
                "severity": "warning",
                "count": 1,
            })
            score = 80
        else:
            score = 100 if detected["extension"].lower() == declared.lower() else 60
        return _normalize(path, ctx, True, score, summary,
                          {"size_bytes": size, "detected": detected, "declared": declared}, issues)

    return _normalize(path, ctx, False, 0,
                      f"BIN ({declared}): tipo de archivo no identificado ({size/1e6:.2f} MB)", {"size_bytes": size},
                      [{"code": "tipo-no-identificado", "label": "No se pudo identificar el tipo de archivo", "severity": "error", "count": 1}])
