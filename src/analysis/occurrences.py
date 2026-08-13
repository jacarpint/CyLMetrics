"""Ocurrencias completas de una incidencia, no una muestra de cinco.

Antes cada incidencia guardaba `samples: [...]` con **como mucho 5 elementos**
(`SAMPLE_LIMIT`), mientras `count` contaba todas: el informe decía
«celda-faltante: 850.658» y traía 5 posiciones. La interfaz no podía enseñar la
sexta, y quien abría el detalle veía cinco filas donde el resumen prometía casi
un millón. Como el análisis se ejecuta en local y sin presupuesto de tiempo, no
hay motivo para muestrear: se guardan todas.

Guardarlas tal cual sí era inviable. Cada muestra repetía `row_values` (la fila
entera) y `header` (la cabecera entera): para 850.658 celdas vacías eso son
gigabytes de cabeceras repetidas. El formato de aquí guarda:

  - la cabecera **una sola vez** por distribución (fuera de las incidencias);
  - las ocurrencias **agrupadas por columna**, porque un fallo de calidad se
    concentra casi siempre en unas pocas columnas;
  - los números de fila **delta-codificados** y ascendentes, que es lo que
    convierte ``[1200, 1201, 1202, …]`` en ``[1200, 1, 1, …]`` y hace que el
    fichero comprima ~10× al servirlo.

El valor de la celda solo se guarda donde ES la información (un texto colado en
una columna de fechas). Para «celda vacía» el valor es, por definición, vacío.

Formato emitido por `finalize_issue`::

    {"code": "error-tipo", "label": "…", "severity": "error",
     "count": 206118,          # ocurrencias detectadas
     "stored": 206118,         # ocurrencias realmente guardadas (ver MAX_…)
     "columns": [{"col": 3, "field": "FECHA",
                  "rows": [117, 4, 4, …],      # deltas, 1-based sobre datos
                  "cells": ["12-13/02/2026", …]}],
     "rows": [12, 3, …]}       # incidencias de fila entera (fila-vacia)

`stored` es obligatorio y la interfaz lo respeta: si alguna vez se recorta, la
ficha dice «mostrando X de Y» en vez de callarlo. Es exactamente lo que el
formato anterior no hacía.
"""
from __future__ import annotations

# Válvula de seguridad, no un muestreo. Un fichero patológico (una hoja de
# cálculo de 5.000 columnas × 200.000 filas casi vacía) puede generar decenas de
# millones de ocurrencias y hacer el fragmento inmanejable para el navegador.
# Al cortar aquí, `stored` queda por debajo de `count` y la interfaz lo dice.
MAX_OCCURRENCES_PER_ISSUE = 2_000_000

# Códigos donde el VALOR de la celda es la información. En los de ausencia
# (celda vacía, celda faltante) el valor es vacío por definición y guardarlo son
# megabytes de cadenas vacías.
CODES_WITH_CELL_VALUE = {
    "error-tipo",
    "encabezado-duplicado",
    "encabezado-vacio",
    "celda-extra",
    "error-restriccion",
    "error-unico",
    "fila-duplicada",
}

#: Longitud máxima del valor de una celda guardado. Antes eran 200 caracteres,
#: que parte un WKT o una descripción larga por la mitad.
MAX_CELL_CHARS = 1_000


def new_issue(code: str, label: str, severity: str, source: str | None = None) -> dict:
    """Acumulador de una incidencia. Se cierra con `finalize_issue`."""
    issue: dict = {
        "code": code,
        "label": label,
        "severity": severity,
        "count": 0,
        # Estado interno (prefijo `_`), eliminado por `finalize_issue`.
        # Clave (hoja, columna): en un libro Excel la fila 5 de «Ventas» y la
        # fila 5 de «Compras» son sitios distintos, y agruparlas solo por columna
        # las mezclaba en una lista de posiciones que no llevaba a ninguna parte.
        "_columns": {},  # (sheet, col) -> {"field": str|None, "rows": [], "cells": []}
        "_rows": [],
        "_stored": 0,
    }
    if source:
        issue["source"] = source
    return issue


def _truncate(value) -> str | None:
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    return text[:MAX_CELL_CHARS]


def add_cell(
    issue: dict,
    row: int,
    col: int | None,
    field: str | None = None,
    cell=None,
    sheet: str | None = None,
) -> None:
    """Registra una ocurrencia en (hoja, fila, columna). `row` es 1-based."""
    if col is None:
        add_row(issue, row)
        return
    issue["count"] += 1
    if issue["_stored"] >= MAX_OCCURRENCES_PER_ISSUE:
        return
    key = (sheet, col)
    group = issue["_columns"].get(key)
    if group is None:
        group = {"field": field, "rows": [], "cells": []}
        issue["_columns"][key] = group
    elif group["field"] is None and field is not None:
        group["field"] = field
    group["rows"].append(row)
    if issue["code"] in CODES_WITH_CELL_VALUE:
        group["cells"].append(_truncate(cell))
    issue["_stored"] += 1


def add_row(issue: dict, row: int | None) -> None:
    """Registra una ocurrencia que afecta a la fila entera (o sin posición)."""
    issue["count"] += 1
    if row is None or issue["_stored"] >= MAX_OCCURRENCES_PER_ISSUE:
        return
    issue["_rows"].append(row)
    issue["_stored"] += 1


def _deltas(rows: list[int]) -> list[int]:
    """Filas ascendentes -> primer valor absoluto y luego incrementos."""
    ordered = sorted(rows)
    out: list[int] = []
    previous = 0
    for row in ordered:
        out.append(row - previous)
        previous = row
    return out


def finalize_issue(issue: dict) -> dict:
    """Cierra el acumulador: delta-codifica y quita el estado interno."""
    result: dict = {
        "code": issue["code"],
        "label": issue["label"],
        "severity": issue["severity"],
        "count": issue["count"],
        "stored": issue["_stored"],
    }
    if "source" in issue:
        result["source"] = issue["source"]

    columns: list[dict] = []
    for key in sorted(issue["_columns"], key=lambda k: (k[0] or "", k[1])):
        sheet, col = key
        group = issue["_columns"][key]
        rows = group["rows"]
        cells = group["cells"]
        if cells and len(cells) == len(rows):
            # Ordenar filas y valores juntos: los deltas exigen orden ascendente.
            paired = sorted(zip(rows, cells), key=lambda pair: pair[0])
            ordered_rows = [row for row, _ in paired]
            ordered_cells = [cell for _, cell in paired]
        else:
            ordered_rows = sorted(rows)
            ordered_cells = []
        entry: dict = {"col": col, "rows": _deltas(ordered_rows)}
        if sheet is not None:
            entry["sheet"] = sheet
        if group["field"] is not None:
            entry["field"] = group["field"]
        if ordered_cells:
            entry["cells"] = ordered_cells
        columns.append(entry)
    if columns:
        result["columns"] = columns
    if issue["_rows"]:
        result["rows"] = _deltas(issue["_rows"])
    return result


def is_accumulator(issue: dict) -> bool:
    """True si la incidencia todavía está abierta (tiene estado interno)."""
    return "_columns" in issue


def finalize_issues(issues: list[dict]) -> list[dict]:
    """Cierra los acumuladores y deja pasar las incidencias ya cerradas."""
    out: list[dict] = []
    for issue in issues:
        if not issue.get("count"):
            continue
        if is_accumulator(issue):
            out.append(finalize_issue(issue))
            continue
        # Incidencias sin posición (la descarga falló, el ZIP no abre). `stored`
        # se rellena aquí para que TODA incidencia del informe lo tenga: la
        # interfaz lo lee siempre y un `undefined` la haría mentir por omisión.
        issue.setdefault("stored", 0)
        out.append(issue)
    return out


def merge_issues(issues: list[dict]) -> list[dict]:
    """Fusiona acumuladores del mismo código conservando TODAS las ocurrencias.

    La versión anterior recortaba a 5 muestras en cada fusión
    (`target["samples"][:5]`), así que juntar Frictionless con las
    comprobaciones propias perdía posiciones de las dos.
    """
    merged: dict[str, dict] = {}
    for issue in issues:
        code = issue.get("code", "problema")
        target = merged.get(code)
        if target is None:
            merged[code] = issue
            continue
        target["count"] += issue["count"]
        # Si cualquiera de las fuentes es un error, la fusión es un error.
        if issue.get("severity") == "error":
            target["severity"] = "error"
        if not (is_accumulator(target) and is_accumulator(issue)):
            continue  # una de las dos ya está cerrada: solo se suman recuentos
        target["_stored"] += issue["_stored"]
        target["_rows"].extend(issue["_rows"])
        for col, group in issue["_columns"].items():
            existing = target["_columns"].get(col)
            if existing is None:
                target["_columns"][col] = group
                continue
            existing["rows"].extend(group["rows"])
            existing["cells"].extend(group["cells"])
            if existing["field"] is None:
                existing["field"] = group["field"]
    return list(merged.values())


def simple_issue(code: str, label: str, severity: str, count: int = 1) -> dict:
    """Incidencia sin posición: la descarga falló, el ZIP no abre, etc.

    Se emite ya cerrada, con `stored` a 0: no hay nada que localizar dentro del
    fichero, y la interfaz debe decir eso en vez de insinuar que faltan datos.
    """
    return {"code": code, "label": label, "severity": severity, "count": count, "stored": 0}


def count_of(issue: dict) -> int:
    """Ocurrencias de una incidencia, esté cerrada o sea un acumulador."""
    return int(issue.get("count") or 0)
