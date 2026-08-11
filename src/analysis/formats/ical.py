"""Análisis de calendarios iCalendar (.ics)."""
from __future__ import annotations

from pathlib import Path

from .tabular import _normalize


def analyze_ical(path: Path, ctx: dict) -> dict:
    try:
        import icalendar
    except ImportError:
        return _normalize(path, ctx, False, 0, "icalendar no está instalado", {}, [
            {"code": "dependencia-faltante", "label": "icalendar no disponible", "severity": "error", "count": 1},
        ])

    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    try:
        cal = icalendar.Calendar.from_ical(text)
    except Exception as exc:
        return _normalize(path, ctx, False, 0, f"iCal: no se pudo parsear ({exc})", {}, [
            {"code": "ical-invalido", "label": "El archivo no es iCalendar válido", "severity": "error", "count": 1},
        ])

    components = [c.name for c in cal.walk()]
    events = components.count("VEVENT")
    todos = components.count("VTODO")
    parse_errors = list(getattr(cal, "errors", []) or [])

    issues: list[dict] = []
    if parse_errors:
        issues.append({"code": "errores-linea", "label": f"{len(parse_errors)} líneas mal formadas ignoradas por el parser", "severity": "warning", "count": len(parse_errors)})
    if events == 0 and todos == 0:
        issues.append({"code": "sin-eventos", "label": "El calendario no contiene VEVENT ni VTODO", "severity": "warning", "count": 1})

    from collections import Counter

    score = 100 - 5 * len(issues)
    ok = not issues
    return _normalize(path, ctx, ok, max(0, score),
                      f"iCal válido: {events} eventos, {todos} tareas, {len(components)} componentes",
                      {"events": events, "todos": todos, "components": len(components),
                       "components_by_name": dict(Counter(components))},
                      issues)
