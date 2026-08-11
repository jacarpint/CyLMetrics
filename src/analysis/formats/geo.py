"""Análisis de GeoJSON: estructura y geometrías."""
from __future__ import annotations

from pathlib import Path

from .tabular import _normalize


def analyze_geojson(path: Path, ctx: dict) -> dict:
    try:
        import geojson
    except ImportError:
        return _normalize(path, ctx, False, 0, "geojson no está instalado", {}, [
            {"code": "dependencia-faltante", "label": "geojson no disponible", "severity": "error", "count": 1},
        ])

    try:
        data = geojson.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return _normalize(path, ctx, False, 0, "GeoJSON no válido (no se puede parsear)", {}, [
            {"code": "geojson-invalido", "label": "El archivo no es GeoJSON válido", "severity": "error", "count": 1},
        ])

    if not isinstance(data, dict):
        return _normalize(path, ctx, False, 0, "GeoJSON: el documento raíz debe ser un objeto", {}, [
            {"code": "raiz-invalida", "label": "La raíz del documento no es un objeto JSON", "severity": "error", "count": 1},
        ])

    kind = data.get("type")
    metrics = {"type": kind}
    issues: list[dict] = []

    if kind == "FeatureCollection":
        features = data.get("features") or []
        metrics["features"] = len(features)
        null_geoms = sum(1 for f in features if not isinstance(f, dict) or f.get("geometry") is None)
        metrics["null_geometries"] = null_geoms
        if null_geoms:
            issues.append({"code": "geometria-nula", "label": "Features sin geometría", "severity": "error", "count": null_geoms})
        if not features:
            issues.append({"code": "sin-features", "label": "FeatureCollection vacía", "severity": "warning", "count": 1})
        ok = len(features) > 0 and null_geoms == 0
        score = 100 - 15 * (1 if null_geoms else 0) - (0 if features else 10)
        score = max(0, min(100, score))
        summary = f"GeoJSON válido: FeatureCollection con {len(features):,} features"
        return _normalize(path, ctx, ok, score, summary, metrics, issues)

    if kind in ("Feature", "Point", "LineString", "Polygon", "MultiPoint", "MultiLineString",
                "MultiPolygon", "GeometryCollection"):
        return _normalize(path, ctx, True, 100, f"GeoJSON válido: {kind}", metrics, [])

    return _normalize(path, ctx, False, 0, f"GeoJSON: tipo desconocido '{kind}'", metrics, [
        {"code": "tipo-desconocido", "label": f"Tipo GeoJSON no reconocido: {kind}", "severity": "error", "count": 1},
    ])
