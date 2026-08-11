"""Análisis de datos tabulares (CSV, TXT, JSON) con Frictionless.

Estrategia en dos capas:
  1. Frictionless: valida estructura (encabezados, filas vacías/cortas, encoding,
     errores de origen) e infiere el esquema.
  2. Comprobaciones propias: Frictionless v5 es tolerante con dos problemas
     habituales en datos abiertos (NO los reporta), así que los detectamos
     nosotros: tipos incoherentes dentro de una columna y celdas vacías.
"""
from __future__ import annotations

import csv
import datetime
import json
from pathlib import Path

from ..checks import detect_encoding, guess_delimiter

# Mapeo de errores de Frictionless -> issues del portal
ERROR_MAP = {
    "type-error": ("error-tipo", "Valores que no coinciden con el tipo inferido de la columna", "error"),
    # Celdas vacías en filas cortas: datos incompletos, no corrupción -> aviso
    "missing-cell": ("celda-faltante", "Celdas vacías en filas con datos", "warning"),
    "blank-row": ("fila-vacia", "Filas completamente vacías", "error"),
    "extra-cell": ("celda-extra", "Más valores que columnas declaradas", "error"),
    "blank-label": ("encabezado-vacio", "Columnas sin etiqueta", "error"),
    "duplicate-label": ("encabezado-duplicado", "Etiquetas de columna duplicadas", "error"),
    "duplicate-row": ("fila-duplicada", "Filas duplicadas", "warning"),
    "source-error": ("error-fuente", "El archivo no se pudo interpretar como datos tabulares", "error"),
    "schema-error": ("error-esquema", "Problemas al inferir el esquema", "error"),
    "constraint-error": ("error-restriccion", "Valores fuera de las restricciones del esquema", "error"),
    "unique-error": ("error-unico", "Valores duplicados en columna única", "error"),
    "encoding-error": ("error-encoding", "Problemas de codificación de caracteres", "error"),
}
WARNING_SEVERITY = {"warning"}
DEFAULT_ISSUE = ("problema", "Problema detectado durante la validación", "error")


def _merge_issues(issues: list[dict]) -> list[dict]:
    """Fusiona issues con el mismo código (p.ej. 'celda-faltante' de Frictionless
    y las comprobaciones propias) sumando counts y conservando muestras."""
    merged: dict[str, dict] = {}
    for iss in issues:
        code = iss.get("code", "problema")
        if code not in merged:
            merged[code] = dict(iss)
            continue
        target = merged[code]
        target["count"] = (target.get("count") or 0) + (iss.get("count") or 0)
        # Si cualquiera de las fuentes es un error, la incidencia fusionada es
        # un error (nunca downgrade por mezclar una advertencia).
        if iss.get("severity") == "error":
            target["severity"] = "error"
        samples = iss.get("samples") or []
        if samples and "samples" not in target:
            target["samples"] = []
        if samples:
            target["samples"] = (target.get("samples") or []) + samples
            target["samples"] = (target["samples"])[:5]
    return list(merged.values())


def _score_from_issues(issues: list[dict]) -> tuple[int, bool]:
    errors = sum(i["count"] for i in issues if i["severity"] == "error")
    warnings = sum(i["count"] for i in issues if i["severity"] == "warning")
    score = 100 - min(60, 15 * len([i for i in issues if i["severity"] == "error"]))
    score -= 5 * len([i for i in issues if i["severity"] == "warning"])
    if errors > 1000:
        score -= 10
    return max(0, min(100, score)), errors == 0


def _collect_frictionless(report) -> list[dict]:
    """Convierte un report de Frictionless en issues del portal.

    El code del issue es el código estable del portal (p. ej. "fila-vacia");
    el tipo crudo de Frictionless queda en el campo "source" como trazabilidad.

    Para cada tipo de error, recopila hasta SAMPLE_LIMIT instancias de ejemplo
    con la posición (fila, columna) y el valor de la celda para visualización
    en la interfaz.
    """
    SAMPLE_LIMIT = 5
    issues: dict[str, dict] = {}

    def _add(err) -> None:
        ftype = getattr(err, "type", "unknown")
        code, label, severity = ERROR_MAP.get(ftype, (ftype, *DEFAULT_ISSUE[1:]))
        entry = issues.setdefault(code, {"code": code, "label": label, "severity": severity, "count": 0, "samples": []})
        entry["count"] += 1
        entry.setdefault("source", ftype)
        if len(entry["samples"]) < SAMPLE_LIMIT:
            sample: dict = {}
            row_num = getattr(err, "row_number", None)
            if row_num is not None:
                sample["row"] = row_num
            field_name = getattr(err, "field_name", None)
            if field_name is not None:
                sample["field"] = field_name
            field_num = getattr(err, "field_number", None)
            if field_num is not None and field_name is None:
                sample["field_index"] = field_num
            cell_val = getattr(err, "cell", None)
            if cell_val is not None:
                sample["cell"] = str(cell_val)[:200]
            cells = getattr(err, "cells", None)
            if cells is not None and isinstance(cells, (list, tuple)):
                sample["row_values"] = [str(c)[:100] if c is not None else None for c in cells[:50]]
            labels = getattr(err, "labels", None)
            if labels is not None and isinstance(labels, (list, tuple)):
                sample["header"] = [str(l)[:100] if l else None for l in labels[:50]]
            entry["samples"].append(sample)

    for task in getattr(report, "tasks", []):
        for err in getattr(task, "errors", []):
            _add(err)
    for err in getattr(report, "errors", []):
        _add(err)
    return list(issues.values())


def _normalize(path: Path, ctx: dict, ok: bool, score: int, summary: str,
               metrics: dict, issues: list[dict],
               schema: list[dict] | None = None,
               sample_rows: list[list] | None = None) -> dict:
    result = {
        "ok": ok,
        "score": score,
        "summary": summary,
        "metrics": metrics or {},
        "issues": issues or [],
        "truncated": bool(ctx.get("truncated")),
    }
    if schema:
        result["schema"] = schema
    if sample_rows:
        result["sample_rows"] = sample_rows
    return result


# ---------------------------------------------------------------------------
# Comprobaciones propias (Frictionless v5 no reporta estos problemas)
# ---------------------------------------------------------------------------

_TYPE_PRIORITY = {"number": 0, "date": 1, "bool": 2, "str": 3, "any": 4}


def _value_type(value) -> str:
    """Tipo 'estricto' de un valor ya parseado (str, int, float, bool, date...).

    int y float se fusionan en "number": mezclar 150 con 150.5 no es un error
    de calidad (en JSON es frecuente y legítimo); sí lo es un texto en una
    columna numérica o de fechas. None / "" se consideran "empty".
    """
    if value is None:
        return "empty"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (datetime.date, datetime.datetime)):
        return "date"
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return "empty"
        if v.lower() in ("true", "false"):
            return "bool"
        try:
            int(v)
            return "number"
        except ValueError:
            pass
        try:
            float(v)
            return "number"
        except ValueError:
            pass
        try:
            datetime.date.fromisoformat(v)
            return "date"
        except ValueError:
            pass
        return "str"
    return "any"


def _check_column_quality(rows: list[list], header: list[str] | None = None) -> tuple[int, int, list[dict], list[dict]]:
    """Devuelve (celdas_con_tipo_incoherente, celdas_vacias, muestras_tipo, muestras_vacias).

    Analiza cada columna: si hay un tipo mayoritario estricto (int, float,
    date, bool), cualquier valor que no lo cumpla se cuenta como error de tipo.
    Las celdas vacías dentro de filas con datos se cuentan aparte (las filas
    cortas las cubre Frictionless con missing-cell).

    Reglas anti-falsos-positivos:
      - Las celdas vacías NO se cuentan como error de tipo (son datos ausentes,
        ya cubiertos por "celda-faltante").
      - Solo se cuentan celdas vacías en columnas mayoritariamente pobladas
        (>= MIN_FILL de la columna). Las columnas opcionales casi vacías
        (teléfono, email, web, observaciones...) no son un fallo del dataset.

    Devuelve listas de muestras de ejemplo (hasta 5 por tipo) con posición,
    columna y valor de la celda.
    """
    SAMPLE_LIMIT = 5
    MIN_FILL = 0.5
    if not rows:
        return 0, 0, [], []
    ncols = max(len(r) for r in rows)
    if ncols == 0:
        return 0, 0, [], []
    nrows = len(rows)
    cols: list[list] = [[] for _ in range(ncols)]
    missing = 0
    type_error_samples: list[dict] = []
    missing_samples: list[dict] = []

    for row_idx, r in enumerate(rows):
        for i in range(ncols):
            if i >= len(r):
                continue  # fila corta -> Frictionless (missing-cell)
            v = r[i]
            if _value_type(v) == "empty":
                continue
            cols[i].append(v)

    type_errors = 0
    for col_idx, col in enumerate(cols):
        if len(col) < 3:
            continue  # pocos valores: no hay base para inferir un tipo
        counts: dict[str, int] = {}
        for v in col:
            t = _value_type(v)
            counts[t] = counts.get(t, 0) + 1
        ranked = sorted(
            counts.items(),
            key=lambda kv: (kv[1], -_TYPE_PRIORITY.get(kv[0], 9)),
            reverse=True,
        )
        winner, winner_count = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else 0
        if winner in ("str", "any"):
            continue
        if winner_count <= second:
            continue  # empate: no señalar nada
        for row_idx, r in enumerate(rows):
            if col_idx >= len(r):
                continue
            v = r[col_idx]
            if _value_type(v) == "empty":
                continue  # dato ausente, no error de tipo
            if _value_type(v) != winner:
                type_errors += 1
                if len(type_error_samples) < SAMPLE_LIMIT:
                    col_name = header[col_idx] if header and col_idx < len(header) else f"Col {col_idx + 1}"
                    sample_row = [str(c)[:100] if c is not None else None for c in r[:50]]
                    type_error_samples.append({
                        "row": row_idx + 2,  # +1 header, +1 1-based
                        "field": col_name,
                        "cell": str(v)[:200] if v is not None else None,
                        "row_values": sample_row,
                        "header": [str(h)[:100] if h else None for h in header[:50]] if header else [],
                    })

    # Celdas vacías solo en columnas mayoritariamente pobladas (opcionales fuera).
    for col_idx in range(ncols):
        col_fill = len(cols[col_idx]) / nrows if nrows else 0
        if col_fill < MIN_FILL:
            continue
        for row_idx, r in enumerate(rows):
            if col_idx >= len(r):
                continue
            if _value_type(r[col_idx]) == "empty":
                missing += 1
                if len(missing_samples) < SAMPLE_LIMIT:
                    col_name = header[col_idx] if header and col_idx < len(header) else f"Col {col_idx + 1}"
                    sample_row = [str(c)[:100] if c is not None else None for c in r[:50]]
                    missing_samples.append({
                        "row": row_idx + 2,  # +1 header, +1 1-based
                        "field": col_name,
                        "cell": None,
                        "row_values": sample_row,
                        "header": [str(h)[:100] if h else None for h in header[:50]] if header else [],
                    })
    return type_errors, missing, type_error_samples, missing_samples


def _append_quality_issues(
    issues: list[dict],
    type_errors: int,
    missing_cells: int,
    type_error_samples: list[dict] | None = None,
    missing_samples: list[dict] | None = None,
) -> None:
    if type_errors:
        entry: dict = {
            "code": "error-tipo",
            "label": "Valores con un tipo distinto al mayoritario de su columna",
            "severity": "error",
            "count": type_errors,
        }
        if type_error_samples:
            entry["samples"] = type_error_samples
        issues.append(entry)
    if missing_cells:
        entry = {
            "code": "celda-faltante",
            "label": "Celdas vacías en filas con datos",
            "severity": "warning",
            "count": missing_cells,
        }
        if missing_samples:
            entry["samples"] = missing_samples
        issues.append(entry)


# ---------------------------------------------------------------------------
# Esquema inferido y muestra de filas (para la ficha del dataset)
# ---------------------------------------------------------------------------

_SAMPLE_ROW_LIMIT = 10
_SCHEMA_COLUMN_LIMIT = 100
# Sin tope: antes se cortaba en 1.000 y la ficha mostraba "1000+" en 1.201
# campos, así que el recuento de valores distintos no era el real. El coste es
# memoria proporcional a los distintos de la columna, aceptable para columnas
# de datos abiertos.
_DISTINCT_CAP: int | None = None

_TYPE_DISPLAY = {"number": "number", "date": "date", "bool": "boolean", "str": "string", "any": "string", "empty": "string"}
_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%Y/%m/%d")


def _try_parse_date(value) -> datetime.date | None:
    """Convierte un valor a date (ISO y formatos comunes d/m/a)."""
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    s = str(value).strip()
    if not s:
        return None
    try:
        return datetime.date.fromisoformat(s)
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _build_schema_and_sample(header: list[str] | None, data_rows: list[list]) -> tuple[list[dict], list[list]]:
    """Perfil de esquema (tipo, nulos, distintos, rango) y muestra de filas.

    Se calcula sobre TODAS las filas descargadas. Mientras la descarga no se
    trunque (ver `--size-cap`), las cifras de nulos, distintos y rango son las
    del fichero completo, no una estimación. Si `analysis.truncated` es cierto,
    la descarga sí se cortó y la interfaz debe advertirlo.
    """
    if not data_rows:
        return [], []
    nrows = len(data_rows)
    ncols = max(len(r) for r in data_rows)
    if ncols == 0:
        return [], []
    ncols = min(ncols, _SCHEMA_COLUMN_LIMIT)

    cols: list[list] = [[] for _ in range(ncols)]
    for r in data_rows:
        for i in range(ncols):
            v = r[i] if i < len(r) else None
            if _value_type(v) == "empty":
                continue
            cols[i].append(v)

    schema: list[dict] = []
    for col_idx, col in enumerate(cols):
        name = header[col_idx] if header and col_idx < len(header) else f"Col {col_idx + 1}"
        counts: dict[str, int] = {}
        for v in col:
            t = _value_type(v)
            counts[t] = counts.get(t, 0) + 1
        if counts:
            winner = max(counts, key=lambda t: (counts[t], -_TYPE_PRIORITY.get(t, 9)))
        else:
            winner = "empty"

        null_count = nrows - len(col)
        seen: set = set()
        for v in col:
            seen.add(v)
            if _DISTINCT_CAP is not None and len(seen) > _DISTINCT_CAP:
                break
        distinct = len(seen)

        entry: dict = {
            "name": name[:80],
            "type": _TYPE_DISPLAY.get(winner, "string"),
            "null_count": null_count,
            "null_pct": round(null_count / nrows, 4) if nrows else 0,
            "distinct": distinct,
        }
        if winner == "number":
            nums: list[float] = []
            for v in col:
                if isinstance(v, bool):
                    continue
                try:
                    nums.append(float(v))
                except (TypeError, ValueError):
                    continue
            if nums:
                entry["min"] = min(nums)
                entry["max"] = max(nums)
        elif winner == "date":
            dates = [_d.isoformat() for _d in (_try_parse_date(v) for v in col) if _d is not None]
            if dates:
                entry["min"] = min(dates)
                entry["max"] = max(dates)
        schema.append(entry)

    sample_rows = [
        [str(c)[:100] if c is not None else None for c in r[:ncols]]
        for r in data_rows[:_SAMPLE_ROW_LIMIT]
    ]
    return schema, sample_rows


def analyze_csv(path: Path, ctx: dict) -> dict:
    from ..checks import looks_like_html

    # URL que apunta a un directorio/landing devuelve HTML, no datos tabulares.
    if looks_like_html(path):
        return _normalize(path, ctx, False, 0,
                          "CSV: la URL devuelve una página HTML (directorio/landing), no datos CSV", {},
                          [{"code": "no-es-archivo",
                            "label": "El recurso CSV apunta a un directorio/página, no a datos tabulares",
                            "severity": "error", "count": 1}])

    sample = path.read_bytes()[:2_000_000]
    encoding = detect_encoding(sample)
    text_sample = sample.decode(encoding, errors="replace")
    delimiter = guess_delimiter(text_sample)

    from frictionless import Dialect, Resource
    from frictionless.formats.csv.control import CsvControl

    try:
        dialect = Dialect(controls=[CsvControl(delimiter=delimiter)])
        resource = Resource(path=str(path), dialect=dialect, encoding=encoding, format="csv")
    except Exception:
        resource = Resource(path=str(path), encoding=encoding, format="csv")

    try:
        report = resource.validate()
    except Exception as exc:
        return _normalize(path, ctx, False, 0, f"No se pudo validar el CSV: {exc}", {}, [
            {"code": "error-validacion", "label": "La validación de Frictionless falló", "severity": "error", "count": 1},
        ])

    issues = _collect_frictionless(report)
    stats = report.tasks[0].stats if report.tasks else {}
    rows = int(stats.get("rows") or 0)
    fields = int(stats.get("fields") or 0)
    score, ok = _score_from_issues(issues)

    # Comprobaciones propias (Frictionless v5 no reporta tipos incoherentes ni
    # celdas vacías). Se recorren todas las filas descargadas.
    type_errors, missing_cells = 0, 0
    schema: list[dict] = []
    sample_rows: list[list] = []
    header, data_rows = _read_csv_rows_with_header(path, delimiter, encoding)
    if data_rows:
        te, mc, te_samples, mc_samples = _check_column_quality(data_rows, header)
        type_errors = te
        missing_cells = mc
        _append_quality_issues(issues, type_errors, missing_cells, te_samples, mc_samples)
        issues = _merge_issues(issues)
        score, ok = _score_from_issues(issues)
        if header:
            schema, sample_rows = _build_schema_and_sample(header, data_rows)

    if rows == 0 and not issues:
        issues.append({"code": "sin-datos", "label": "El archivo no contiene filas de datos", "severity": "error", "count": 1})
        score, ok = 0, False

    summary = (
        f"CSV válido: {rows:,} filas × {fields} columnas (delimitador '{delimiter}', {encoding})"
        if ok
        else f"CSV con problemas: {rows:,} filas × {fields} columnas, {len(issues)} tipos de incidencia (delimitador '{delimiter}')"
    )
    metrics: dict = {
        "rows": rows,
        "columns": fields,
        "delimiter": delimiter,
        "encoding": encoding,
        "error_cells": type_errors + missing_cells,
    }
    if header:
        metrics["header"] = header[:50]
    return _normalize(path, ctx, ok, score, summary, metrics, issues, schema=schema, sample_rows=sample_rows)


def _read_csv_rows_with_header(path: Path, delimiter: str, encoding: str) -> tuple[list[str], list[list]]:
    """Lee el encabezado y todas las filas de datos (sin filas vacías)."""
    try:
        with open(path, "r", encoding=encoding, newline="") as fh:
            reader = csv.reader(fh, delimiter=delimiter)
            raw_rows = [r for r in reader]
    except Exception:
        return [], []
    if not raw_rows:
        return [], []
    header = [h.strip() if h else f"Col {i + 1}" for i, h in enumerate(raw_rows[0])]
    data_rows = [r for r in raw_rows[1:] if any(cell.strip() for cell in r)]
    return header, data_rows


def _read_csv_rows(path: Path, delimiter: str, encoding: str) -> list[list]:
    """Lee todas las filas (sin encabezado, sin filas vacías) para el análisis propio."""
    _, data_rows = _read_csv_rows_with_header(path, delimiter, encoding)
    return data_rows


def analyze_txt(path: Path, ctx: dict) -> dict:
    """TXT: si parece tabular (varias columnas) se analiza como CSV; si no, estructura básica."""
    sample = path.read_bytes()[:2_000_000]
    encoding = detect_encoding(sample)
    text_sample = sample.decode(encoding, errors="replace")
    delimiter = guess_delimiter(text_sample)
    first_lines = [ln for ln in text_sample.splitlines() if ln.strip()][:3]

    # Si todas las líneas tienen el delimitador -> tabular
    if first_lines and all(delimiter in ln for ln in first_lines):
        res = analyze_csv(path, ctx)
        res["summary"] = f"TXT tabular: {res['summary']}"
        res["metrics"]["kind"] = "tabular"
        return res

    lines = [ln for ln in text_sample.splitlines() if ln.strip()]
    issues = []
    score, ok = 100, True
    if not lines:
        issues.append({"code": "sin-contenido", "label": "El archivo de texto está vacío", "severity": "error", "count": 1})
        score, ok = 0, False
    return _normalize(
        path, ctx, ok, score,
        f"TXT de texto libre: {len(lines):,} líneas no vacías ({encoding})",
        {"lines": len(lines), "encoding": encoding, "kind": "text"},
        issues,
    )


def analyze_json(path: Path, ctx: dict) -> dict:
    from ..checks import looks_like_html

    # URL que apunta a un directorio/landing devuelve HTML, no JSON.
    if looks_like_html(path):
        return _normalize(path, ctx, False, 0, "JSON: la URL devuelve una página HTML (directorio/landing), no datos JSON", {}, [
            {"code": "no-es-archivo",
             "label": "El recurso JSON apunta a un directorio/página, no a datos",
             "severity": "error", "count": 1},
        ])

    try:
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        # Intento con detección de encoding
        try:
            raw = path.read_bytes()
            data = json.loads(raw.decode(detect_encoding(raw[:1_000_000])))
        except Exception as exc:
            return _normalize(path, ctx, False, 0, "JSON no válido (no se puede parsear)", {}, [
                {"code": "json-invalido", "label": "El archivo no es JSON válido", "severity": "error", "count": 1},
            ])

    issues: list[dict] = []

    # Estructura JSON genérica
    kind = type(data).__name__
    metrics = {"kind": kind}
    if isinstance(data, list):
        metrics["elements"] = len(data)
    elif isinstance(data, dict):
        metrics["top_keys"] = len(data.keys())
        nested = sum(1 for v in data.values() if isinstance(v, (list, dict)))
        metrics["nested_values"] = nested

    # Si es una lista de objetos/arrays -> validación tabular con Frictionless
    if isinstance(data, list) and data and isinstance(data[0], (dict, list)):
        try:
            from frictionless import Resource

            report = Resource(path=str(path), format="json").validate()
            issues = _collect_frictionless(report)
            stats = report.tasks[0].stats if report.tasks else {}
            metrics["rows"] = int(stats.get("rows") or len(data))
            metrics["columns"] = len(data[0]) if isinstance(data[0], (list, dict)) else 0
            score, ok = _score_from_issues(issues)

            # Comprobación propia de calidad de columnas (valores ya tipados)
            first = data[0]
            header_cols: list[str] = []
            if isinstance(first, dict):
                header_cols = list(first.keys())
                rows_data = [[d.get(k) for k in header_cols] for d in data]
            else:
                rows_data = [list(r) for r in data]
            type_errors, missing_cells, te_samples, mc_samples = _check_column_quality(rows_data, header_cols or None)
            _append_quality_issues(issues, type_errors, missing_cells, te_samples, mc_samples)
            issues = _merge_issues(issues)
            score, ok = _score_from_issues(issues)
            metrics["error_cells"] = type_errors + missing_cells
            if header_cols:
                metrics["header"] = header_cols[:50]

            schema: list[dict] = []
            sample_rows: list[list] = []
            if rows_data and header_cols:
                schema, sample_rows = _build_schema_and_sample(header_cols, rows_data)

            summary = (
                f"JSON tabular válido: {metrics['rows']:,} elementos"
                if ok
                else f"JSON tabular con problemas: {len(issues)} tipos de incidencia"
            )
            return _normalize(path, ctx, ok, score, summary, metrics, issues, schema=schema, sample_rows=sample_rows)
        except Exception:
            pass  # fallback: solo estructura

    if not data:
        issues.append({"code": "sin-contenido", "label": "El JSON está vacío", "severity": "error", "count": 1})
        return _normalize(path, ctx, False, 0, "JSON vacío", metrics, issues)

    return _normalize(path, ctx, True, 100, f"JSON válido ({kind} con {metrics.get('elements') or metrics.get('top_keys')} elementos)", metrics, issues)
