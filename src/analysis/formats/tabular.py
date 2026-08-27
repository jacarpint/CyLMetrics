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
import re
from pathlib import Path

from ..checks import detect_encoding, guess_delimiter
from ..json_records import json_record_table
from ..occurrences import (
    MAX_CELL_CHARS,
    add_cell,
    add_row,
    finalize_issues,
    merge_issues,
    new_issue,
    simple_issue,
)

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


#: Fusión de incidencias del mismo código (Frictionless + comprobaciones
#: propias). Vive en `occurrences` porque XLSX necesita exactamente la misma.
_merge_issues = merge_issues


def _score_from_issues(issues: list[dict]) -> tuple[int, bool]:
    errors = sum(i["count"] for i in issues if i["severity"] == "error")
    warnings = sum(i["count"] for i in issues if i["severity"] == "warning")
    score = 100 - min(60, 15 * len([i for i in issues if i["severity"] == "error"]))
    score -= 5 * len([i for i in issues if i["severity"] == "warning"])
    if errors > 1000:
        score -= 10
    return max(0, min(100, score)), errors == 0


def _collect_frictionless(report) -> list[dict]:
    """Convierte un report de Frictionless en acumuladores de incidencia.

    El code del issue es el código estable del portal (p. ej. "fila-vacia");
    el tipo crudo de Frictionless queda en el campo "source" como trazabilidad.

    Se registran **todas** las posiciones, no las primeras cinco: `row_values` y
    `header` ya no se copian en cada ocurrencia (la cabecera se guarda una vez
    por distribución), así que guardarlas todas cuesta un entero por ocurrencia.
    """
    issues: dict[str, dict] = {}

    def _add(err) -> None:
        ftype = getattr(err, "type", "unknown")
        code, label, severity = ERROR_MAP.get(ftype, (ftype, *DEFAULT_ISSUE[1:]))
        entry = issues.get(code)
        if entry is None:
            entry = new_issue(code, label, severity, source=ftype)
            issues[code] = entry

        row_num = getattr(err, "row_number", None)
        field_name = getattr(err, "field_name", None)
        field_num = getattr(err, "field_number", None)
        cell_val = getattr(err, "cell", None)
        # `field_number` de Frictionless es 1-based; el formato del informe usa
        # índices de columna 0-based, como el resto del portal.
        col = field_num - 1 if isinstance(field_num, int) and field_num > 0 else None
        if col is None and row_num is None:
            add_row(entry, None)
        elif col is None:
            add_row(entry, row_num)
        else:
            add_cell(entry, row_num or 0, col, field_name, cell_val)

    for task in getattr(report, "tasks", []):
        for err in getattr(task, "errors", []):
            _add(err)
    for err in getattr(report, "errors", []):
        _add(err)
    return list(issues.values())


def _normalize(path: Path, ctx: dict, ok: bool, score: int | None, summary: str,
               metrics: dict, issues: list[dict],
               schema: list[dict] | None = None,
               sample_rows: list[list] | None = None) -> dict:
    """
    `score=None` significa «no lo hemos medido», y no es lo mismo que un cero.

    `report.py` mete en las medias la nota de todo resultado que la tenga, así que
    poner 0 cuando el análisis no ha llegado a mirar el archivo contamina las
    cifras del formato entero: los cinco analizadores que devolvían 0 al faltarles
    su librería dejaron `XLSX: avg_score 0` en el informe del 13 de agosto, a
    partir de 341 ceros que no medían ningún Excel. Con `None` esos resultados se
    quedan fuera de las medias por sí solos.
    """
    # Único punto donde las incidencias se cierran: así ningún analizador puede
    # emitir un acumulador a medio construir en el informe.
    result = {
        "ok": ok,
        "score": score,
        "summary": summary,
        "metrics": metrics or {},
        "issues": finalize_issues(issues or []),
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


#: Número decimal corriente. Deliberadamente estrecho, y deliberadamente el
#: MISMO patrón que `NUMBER_LITERAL` en `src/lib/tabular-analysis.ts`.
#:
#: Antes cada lado usaba los literales de su lenguaje y contaban distinto sobre
#: el mismo fichero: `int("1_000")` en Python vale 1000 (los guiones bajos son
#: legales desde 3.6) y `Number("1_000")` en JavaScript es NaN; al revés,
#: `Number("0x1A")` vale 26 y `int("0x1A")` falla. Cada discrepancia era un
#: `error-tipo` que aparecía en una pantalla y no en la otra.
_NUMBER_LITERAL = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")

#: Fecha ISO de calendario. `datetime.date.fromisoformat` acepta desde Python
#: 3.11 formatos que el visor no reconoce ("20260813", "2026-W32-1", fechas con
#: hora), así que aquí se exige la forma estricta, igual que `ISO_DATE` en TS.
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _value_type(value) -> str:
    """Tipo 'estricto' de un valor ya parseado (str, int, float, bool, date...).

    int y float se fusionan en "number": mezclar 150 con 150.5 no es un error
    de calidad (en JSON es frecuente y legítimo); sí lo es un texto en una
    columna numérica o de fechas. None / "" se consideran "empty".

    Las ramas de tipo nativo (int, date…) solo se alcanzan desde XLSX, donde
    openpyxl devuelve valores ya tipados. CSV y JSON llegan aquí como texto y
    pasan por el mismo camino que el visor del navegador.
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
        if _NUMBER_LITERAL.match(v):
            return "number"
        if _ISO_DATE.match(v):
            try:
                datetime.date.fromisoformat(v)
                return "date"
            except ValueError:
                pass
        return "str"
    return "any"


def _check_column_quality(
    rows: list[list],
    header: list[str] | None = None,
    sheet: str | None = None,
    type_issue: dict | None = None,
    missing_issue: dict | None = None,
) -> tuple[int, int, dict, dict]:
    """Devuelve (celdas_con_tipo_incoherente, celdas_vacias, acum_tipo, acum_vacias).

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

    Devuelve dos acumuladores con TODAS las posiciones (fila, columna), no una
    muestra: el recuento y el detalle salen de la misma pasada, así que no
    pueden discrepar.

    `sheet` etiqueta las posiciones cuando el origen tiene varias hojas, y
    `type_issue`/`missing_issue` permiten seguir acumulando sobre los mismos
    acumuladores hoja tras hoja en lugar de sumar cifras sueltas.
    """
    MIN_FILL = 0.5
    if type_issue is None:
        type_issue = new_issue("error-tipo", "Valores con un tipo distinto al mayoritario de su columna", "error")
    if missing_issue is None:
        missing_issue = new_issue("celda-faltante", "Celdas vacías en filas con datos", "warning")
    if not rows:
        return 0, 0, type_issue, missing_issue
    ncols = max(len(r) for r in rows)
    if ncols == 0:
        return 0, 0, type_issue, missing_issue
    nrows = len(rows)
    cols: list[list] = [[] for _ in range(ncols)]
    missing = 0

    def _field(col_idx: int) -> str:
        return header[col_idx] if header and col_idx < len(header) else f"Col {col_idx + 1}"

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
                # +1 por el encabezado, +1 porque la interfaz numera desde 1.
                add_cell(type_issue, row_idx + 2, col_idx, _field(col_idx), v, sheet=sheet)

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
                add_cell(missing_issue, row_idx + 2, col_idx, _field(col_idx), sheet=sheet)
    return type_errors, missing, type_issue, missing_issue


def _append_quality_issues(issues: list[dict], type_issue: dict, missing_issue: dict) -> None:
    """Añade los acumuladores de las comprobaciones propias, si registraron algo.

    Antes recibía los recuentos por un lado y las muestras por otro, y quien
    llamaba podía pasar unos que no correspondían a las otras. Ahora es el mismo
    objeto: el recuento y las posiciones no se pueden desincronizar.
    """
    for issue in (type_issue, missing_issue):
        if issue.get("count"):
            issues.append(issue)


# ---------------------------------------------------------------------------
# Esquema inferido y muestra de filas (para la ficha del dataset)
# ---------------------------------------------------------------------------

# Filas de muestra que viajan al fragmento de la distribución. Con 10 no se veía
# ni una página de la tabla; 200 dan contexto suficiente sin arrastrar el fichero
# entero, que para eso está el visor.
_SAMPLE_ROW_LIMIT = 200
# Sin tope de columnas: cortar en 100 dejaba fuera del esquema —y de las filas de
# muestra, que se recortaban al mismo ancho— las columnas 101 en adelante, sin
# decirlo en ninguna parte.
_SCHEMA_COLUMN_LIMIT: int | None = None
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
    if _SCHEMA_COLUMN_LIMIT is not None:
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
            "name": name[:200],
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
        [str(c)[:MAX_CELL_CHARS] if c is not None else None for c in r[:ncols]]
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
        type_errors, missing_cells, type_issue, missing_issue = _check_column_quality(data_rows, header)
        _append_quality_issues(issues, type_issue, missing_issue)
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
        metrics["header"] = header
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

    # Las líneas se cuentan sobre el ARCHIVO ENTERO, no sobre la muestra.
    #
    # `sample` son los primeros 2 MB, que están bien para adivinar codificación y
    # delimitador pero no para dar una cifra: `metrics.lines` y el resumen decían
    # «N líneas no vacías» a secas, y en cualquier TXT de más de 2 MB esa N era la
    # de su principio presentada como el total del archivo. Es el mismo defecto
    # que ya se corrigió en `excel.py` y en `shapefile.py`, donde el recuento
    # global convivía con incidencias medidas sobre una muestra.
    #
    # Se recorre en streaming en lugar de cargarlo: contar no necesita el archivo
    # en memoria, y estos ficheros llegan a los cientos de megas.
    lines = 0
    try:
        with open(path, "r", encoding=encoding, errors="replace", newline="") as fh:
            for linea in fh:
                if linea.strip():
                    lines += 1
    except Exception:
        # Si la lectura completa falla, la muestra es mejor que nada, pero la
        # cifra tiene que decir de dónde sale.
        lines = len([ln for ln in text_sample.splitlines() if ln.strip()])
        return _normalize(
            path, ctx, True, 100,
            f"TXT de texto libre: al menos {lines:,} líneas no vacías en los primeros "
            f"{len(sample) // 1024} KB ({encoding})",
            {"lines": lines, "lines_partial": True, "encoding": encoding, "kind": "text"},
            [],
        )

    issues = []
    score, ok = 100, True
    if lines == 0:
        issues.append({"code": "sin-contenido", "label": "El archivo de texto está vacío", "severity": "error", "count": 1})
        score, ok = 0, False
    return _normalize(
        path, ctx, ok, score,
        f"TXT de texto libre: {lines:,} líneas no vacías ({encoding})",
        {"lines": lines, "encoding": encoding, "kind": "text"},
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

    # Registros del documento, estén en la raíz o dentro de un envoltorio.
    #
    # Antes esta condición era `isinstance(data, list) and data and ...`: solo se
    # analizaba si la lista era la RAÍZ del documento. Un JSON tan corriente como
    # `{"document": {"date": …, "list": [ … ]}}` se archivaba como «JSON válido»,
    # sin incidencias y con 100 puntos, mientras el visor —que sí baja a buscar
    # la lista— encontraba la tabla y mostraba N incidencias. Ese es el caso de
    # «el resumen dice que no hay problemas y el detalle dice que sí».
    records = json_record_table(data)
    if records is not None:
        header_cols, rows_data, irregular, records_path = records
        try:
            issues = []
            # Frictionless solo sabe leer la lista si está en la raíz; si los
            # registros venían envueltos, la validación estructural se salta y
            # el análisis se apoya en las comprobaciones propias, que operan
            # sobre la tabla ya aplanada.
            if isinstance(data, list):
                from frictionless import Resource

                report = Resource(path=str(path), format="json").validate()
                issues = _collect_frictionless(report)

            metrics["rows"] = len(rows_data)
            metrics["columns"] = len(header_cols)
            if records_path:
                metrics["records_path"] = records_path
            if irregular:
                metrics["irregular_records"] = irregular

            type_errors, missing_cells, type_issue, missing_issue = _check_column_quality(
                rows_data, header_cols or None
            )
            _append_quality_issues(issues, type_issue, missing_issue)
            issues = _merge_issues(issues)
            score, ok = _score_from_issues(issues)
            metrics["error_cells"] = type_errors + missing_cells
            if header_cols:
                metrics["header"] = header_cols

            schema: list[dict] = []
            sample_rows: list[list] = []
            if rows_data and header_cols:
                schema, sample_rows = _build_schema_and_sample(header_cols, rows_data)

            summary = (
                f"JSON tabular válido: {metrics['rows']:,} registros"
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
