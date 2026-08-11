"""Análisis de Excel (XLSX / XLS legado).

Particularidad del catálogo jcyl: las 346 distribuciones declaradas como XLSX
tienen URL con extensión .xls, y el contenido real varía (la mayoría sirve
XLSX real). Por eso el análisis decide el formato por MAGIC BYTES, no por la
extensión:

  - PK\\x03\\x04 (ZIP)      -> XLSX real: openpyxl (vía BytesIO)
  - \\xd0\\xcf\\x11\\xe0 (OLE2) -> Excel 97-2003 legado: xlrd
  - otro                    -> el contenido no es un libro Excel
"""
from __future__ import annotations

import io
from pathlib import Path

from .tabular import _collect_frictionless, _score_from_issues, _normalize, _check_column_quality, _append_quality_issues, _merge_issues, _build_schema_and_sample

MAX_SHEETS_VALIDATED = 3
MAX_QUALITY_ROWS = 2000


def _analyze_with(load_fn, path: Path, ctx: dict) -> dict:
    """Análisis común: hoja(s), validación Frictionless y calidad de columnas.

    `load_fn` recibe la ruta y devuelve un objeto con .sheetnames y .__getitem__.
    """
    issues: list[dict] = []
    issues_sum = 0
    try:
        wb = load_fn()
    except Exception as exc:
        return _normalize(path, ctx, False, 0, "XLSX no válido (no se puede abrir)", {}, [
            {"code": "xlsx-invalido", "label": f"El archivo Excel no se puede abrir: {exc}", "severity": "error", "count": 1},
        ])

    try:
        sheet_names = wb.sheetnames
        sheets = []
        total_rows = 0

        # Validación tabular de las primeras hojas con Frictionless
        for name in sheet_names[:MAX_SHEETS_VALIDATED]:
            try:
                from frictionless import Dialect, Resource
                from frictionless.formats.excel.control import ExcelControl

                dialect = Dialect(controls=[ExcelControl(sheet=name)])
                report = Resource(path=str(path), dialect=dialect, format="excel").validate()
            except Exception:
                try:
                    report = Resource(path=str(path), format="excel").validate()
                except Exception:
                    continue
            sheet_issues = _collect_frictionless(report)
            issues.extend(sheet_issues)
            issues_sum += sum(i["count"] for i in sheet_issues)

        # Una pasada por hoja: dimensión (max_row/max_column no son fiables en
        # read_only) + muestra de hasta MAX_QUALITY_ROWS filas para el análisis
        # propio de calidad (tipos incoherentes y celdas vacías).
        type_errors, missing_cells = 0, 0
        all_te_samples: list[dict] = []
        all_mc_samples: list[dict] = []
        header: list[str] = []
        first_sheet_rows: list[list] = []
        for idx, name in enumerate(sheet_names):
            ws = wb[name]
            row_count, col_count = 0, 0
            sample_rows: list[list] = []
            for row in ws.iter_rows(values_only=True):
                row_count += 1
                col_count = max(col_count, len(row))
                if idx < MAX_SHEETS_VALIDATED and row_count <= MAX_QUALITY_ROWS + 1:
                    if any(v is not None and str(v).strip() for v in row):
                        sample_rows.append(list(row))
            sheets.append({"name": name, "rows": row_count, "columns": col_count})
            total_rows += row_count
            if idx < MAX_SHEETS_VALIDATED and len(sample_rows) > 1:
                # Extract header from first data row
                if not header and sample_rows:
                    header = [str(h)[:100] if h else f"Col {i + 1}" for i, h in enumerate(sample_rows[0])]
                    first_sheet_rows = [list(r) for r in sample_rows[1:]]
                te, mc, te_samples, mc_samples = _check_column_quality(sample_rows[1:], header or None)
                type_errors += te
                missing_cells += mc
                all_te_samples.extend(te_samples)
                all_mc_samples.extend(mc_samples)
        _append_quality_issues(issues, type_errors, missing_cells, all_te_samples[:5], all_mc_samples[:5])
        issues = _merge_issues(issues)

        score, ok = _score_from_issues(issues)
        if total_rows == 0:
            issues.append({"code": "sin-datos", "label": "El libro no contiene filas de datos", "severity": "error", "count": 1})
            score, ok = 0, False

        summary = (
            f"XLSX válido: {len(sheet_names)} hojas, {total_rows:,} filas en total"
            if ok
            else f"XLSX con problemas: {len(sheet_names)} hojas, {total_rows:,} filas, {len(issues)} tipos de incidencia"
        )
        metrics: dict = {
            "sheets": sheets, "sheet_count": len(sheet_names), "total_rows": total_rows,
            "error_cells": issues_sum + type_errors + missing_cells,
        }
        if header:
            metrics["header"] = header[:50]
        schema: list[dict] = []
        sample_rows_out: list[list] = []
        if header and first_sheet_rows:
            schema, sample_rows_out = _build_schema_and_sample(header, first_sheet_rows)
        return _normalize(path, ctx, ok, score, summary, metrics, issues, schema=schema, sample_rows=sample_rows_out)
    finally:
        try:
            wb.close()
        except Exception:
            pass


def analyze_xlsx(path: Path, ctx: dict) -> dict:
    try:
        import openpyxl
    except ImportError:
        return _normalize(path, ctx, False, 0, "openpyxl no está instalado", {}, [
            {"code": "dependencia-faltante", "label": "openpyxl no disponible", "severity": "error", "count": 1},
        ])

    raw = path.read_bytes()
    magic = raw[:8]

    # XLSX real (ZIP) aunque la URL diga .xls
    if magic.startswith(b"PK\x03\x04"):
        return _analyze_with(
            lambda: openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True),
            path, ctx,
        )

    # Excel 97-2003 legado (OLE2): se lee con xlrd (viene con frictionless[excel])
    if magic.startswith(b"\xd0\xcf\x11\xe0"):
        return analyze_xlsx_legacy(path, ctx)

    return _normalize(path, ctx, False, 0,
                      "Declarado XLSX pero el contenido no es un libro Excel",
                      {"magic": magic.hex()},
                      [{"code": "formato-no-esperado",
                        "label": "El archivo declarado como XLSX no es un libro Excel (¿HTML de error, PDF, etc.?)",
                        "severity": "error", "count": 1}])


def analyze_xlsx_legacy(path: Path, ctx: dict) -> dict:
    """XLS legado (OLE2) leído con xlrd."""
    import xlrd

    try:
        book = xlrd.open_workbook(filename=str(path))
    except Exception as exc:
        return _normalize(path, ctx, False, 0, "XLS legado no válido (no se puede abrir)", {}, [
            {"code": "xls-legado", "label": f"Excel 97-2003 ilegible: {exc}", "severity": "error", "count": 1},
        ])

    sheets = []
    total_rows = 0
    for sh in book.sheets():
        sheets.append({"name": sh.name, "rows": sh.nrows, "columns": sh.ncols})
        total_rows += sh.nrows

    issues: list[dict] = []
    issues_sum = 0

    # Validación estructural con Frictionless (formato xls)
    for sh in book.sheets()[:MAX_SHEETS_VALIDATED]:
        try:
            from frictionless import Resource

            report = Resource(path=str(path), format="xls").validate()
            sheet_issues = _collect_frictionless(report)
            issues.extend(sheet_issues)
            issues_sum += sum(i["count"] for i in sheet_issues)
            break
        except Exception:
            continue

    # Comprobaciones propias de calidad de columnas (valores tipados de xlrd)
    type_errors, missing_cells = 0, 0
    all_te_samples: list[dict] = []
    all_mc_samples: list[dict] = []
    header: list[str] = []
    first_sheet_rows: list[list] = []
    for sh in book.sheets()[:MAX_SHEETS_VALIDATED]:
        sample_rows: list[list] = []
        for ri in range(min(sh.nrows, MAX_QUALITY_ROWS + 1)):
            row = [sh.cell_value(ri, ci) for ci in range(sh.ncols)]
            if any(v is not None and str(v).strip() for v in row):
                sample_rows.append(list(row))
        if len(sample_rows) > 1:
            if not header and sample_rows:
                header = [str(h)[:100] if h else f"Col {i + 1}" for i, h in enumerate(sample_rows[0])]
                first_sheet_rows = [list(r) for r in sample_rows[1:]]
            te, mc, te_samples, mc_samples = _check_column_quality(sample_rows[1:], header or None)
            type_errors += te
            missing_cells += mc
            all_te_samples.extend(te_samples)
            all_mc_samples.extend(mc_samples)
    _append_quality_issues(issues, type_errors, missing_cells, all_te_samples[:5], all_mc_samples[:5])
    issues = _merge_issues(issues)

    # El catálogo declara XLSX pero sirve XLS: incoherencia de metadatos
    issues.append({"code": "xls-legado",
                   "label": "Declarado como XLSX en el catálogo, pero el archivo es Excel 97-2003 (.xls)",
                   "severity": "warning", "count": 1})

    score, ok = _score_from_issues(issues)
    if total_rows == 0:
        issues.append({"code": "sin-datos", "label": "El libro no contiene filas de datos", "severity": "error", "count": 1})
        score, ok = 0, False

    summary = (
        f"XLS legado analizado: {len(sheets)} hojas, {total_rows:,} filas"
        if ok
        else f"XLS legado con problemas: {len(sheets)} hojas, {total_rows:,} filas, {len(issues)} tipos de incidencia"
    )
    metrics: dict = {
        "sheets": sheets, "sheet_count": len(sheets), "total_rows": total_rows,
        "error_cells": issues_sum + type_errors + missing_cells,
    }
    if header:
        metrics["header"] = header[:50]
    schema: list[dict] = []
    sample_rows_out: list[list] = []
    if header and first_sheet_rows:
        schema, sample_rows_out = _build_schema_and_sample(header, first_sheet_rows)
    return _normalize(path, ctx, ok, score, summary, metrics, issues, schema=schema, sample_rows=sample_rows_out)
