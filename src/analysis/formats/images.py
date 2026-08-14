"""Análisis de imágenes: JPEG (Pillow) y ECW (firma + tamaño)."""
from __future__ import annotations

from pathlib import Path

from ..checks import is_ecw, is_jpeg, looks_like_html, missing_dependency_issue
from .tabular import _normalize


def _bad_signature(path: Path, ctx: dict, kind: str) -> dict:
    if looks_like_html(path):
        return _normalize(path, ctx, False, 0,
                          f"{kind}: la URL no apunta a una imagen (devuelve una página HTML)", {},
                          [{"code": "no-es-imagen", "label": "El contenido descargado es HTML, no una imagen", "severity": "error", "count": 1}])
    return _normalize(path, ctx, False, 0, f"{kind}: la firma del archivo no corresponde a un {kind}", {}, [
        {"code": "firma-invalida", "label": "La firma (magic bytes) no es la esperada", "severity": "error", "count": 1},
    ])


def analyze_jpeg(path: Path, ctx: dict) -> dict:
    if not is_jpeg(path):
        return _bad_signature(path, ctx, "JPEG")
    try:
        from PIL import Image
    except ImportError:
        return _normalize(
            path, ctx, False, None,
            "No analizado: falta Pillow en el entorno de análisis",
            {}, [missing_dependency_issue("Pillow")],
        )
    try:
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            width, height = img.size
            mode = img.mode
            fmt = img.format
    except Exception as exc:
        return _normalize(path, ctx, False, 0, f"JPEG: imagen corrupta o no decodificable ({exc})", {}, [
            {"code": "imagen-corrupta", "label": "La imagen no se puede decodificar", "severity": "error", "count": 1},
        ])
    return _normalize(path, ctx, True, 100,
                      f"JPEG válido: {width}×{height} px, modo {mode}",
                      {"width": width, "height": height, "mode": mode, "format": fmt}, [])


def analyze_ecw(path: Path, ctx: dict) -> dict:
    size = path.stat().st_size
    if is_ecw(path):
        return _normalize(path, ctx, True, 100,
                          f"ECW reconocido por firma ({size/1e6:.1f} MB) — formato propietario, contenido no analizable",
                          {"size_bytes": size, "format_detected": "ECW"}, [])
    return _bad_signature(path, ctx, "ECW")
