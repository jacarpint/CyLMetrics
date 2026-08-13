"""Dónde están los registros dentro de un JSON, y cómo se aplanan a tabla.

Port de `src/lib/json-to-table.ts`. Existe porque las dos implementaciones
tenían criterios distintos y eso salía a la cara del usuario: el analizador solo
consideraba tabular un JSON cuya **raíz** fuese una lista, así que un envoltorio
tan corriente como ``{"document": {"date": …, "list": [ … ]}}`` se archivaba
como «JSON válido», `issues: []`, puntuación 100 — y al abrir la ficha, el
navegador (que sí baja a buscar la lista) encontraba la tabla y enseñaba N
incidencias. El resumen decía cero y el detalle decía N sobre el mismo fichero.

Las tres reglas que hay que replicar, en este orden:

1. `find_records`   — baja hasta `MAX_DEPTH` niveles y se queda con la lista de
   registros más larga que encuentre.
2. `_unwrap_single_key` — deshace ``[{"element": {…}}, …]``, habitual en el
   portal, que si no deja una tabla de una sola columna con el registro entero
   serializado dentro.
3. `_name_value_table` — convierte los registros codificados como pares
   nombre/valor (``[{"name": "Titulo_es", "string": "…"}]``) en columnas reales.

Cualquier cambio aquí hay que hacerlo también en `json-to-table.ts`, y el test
compartido `tests/test_json_records.py` está para que no se olvide.
"""
from __future__ import annotations

import json

#: Hasta dónde se baja buscando la lista de registros.
MAX_DEPTH = 4


def cell_text(value) -> str:
    """Valor JSON -> texto de celda, sin perder la distinción entre vacío y null."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        # Antes que `int`: en Python `True` es instancia de `int` y se habría
        # serializado como "1", que no es lo que escribe `JSON.stringify`.
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return str(value)


def is_tabular_json(data) -> bool:
    """¿Es una lista de registros que se puede pintar como tabla?"""
    return isinstance(data, list) and len(data) > 0 and isinstance(data[0], (dict, list))


def find_records(data) -> tuple[list, str] | None:
    """Lista de registros del documento y la ruta donde estaba, o None."""
    best: tuple[list, str] | None = None

    def visit(value, path: str, depth: int) -> None:
        nonlocal best
        if depth > MAX_DEPTH or not isinstance(value, (dict, list)):
            return
        if isinstance(value, list):
            # No se entra en los elementos: sus hijos ya no son «la lista».
            if is_tabular_json(value) and (best is None or len(value) > len(best[0])):
                best = (value, path)
            return
        for key, child in value.items():
            visit(child, f"{path}.{key}" if path else str(key), depth + 1)

    visit(data, "", 0)
    return None if best is None else _unwrap_single_key(best)


def _unwrap_single_key(source: tuple[list, str]) -> tuple[list, str]:
    """Deshace el envoltorio de un solo campo (``[{"element": {…}}, …]``)."""
    items, path = source
    wrapper: str | None = None

    for item in items:
        if not isinstance(item, dict):
            return source
        keys = list(item.keys())
        if len(keys) != 1:
            return source
        if wrapper is not None and keys[0] != wrapper:
            return source
        inner = item[keys[0]]
        if not isinstance(inner, dict):
            return source
        wrapper = keys[0]

    if wrapper is None:
        return source
    return ([item[wrapper] for item in items], f"{path}[].{wrapper}")


def _name_value_table(items: list) -> tuple[list[str], list[list[str]], int, str] | None:
    """Registros como pares nombre/valor -> (cabecera, filas, irregulares, clave).

    Muchos JSON del portal no guardan los campos como claves sino como una lista
    de pares ``{"name": "CodigoPostal", "valor": "05120"}``. El nombre de la
    clave que lleva el valor cambia según el tipo (`valor`, `string`, `text`,
    `date`, `link`…), así que se toma la primera que no sea `name`.
    """
    if not items:
        return None

    list_key: str | None = None
    per_record: list[dict[str, list[str]]] = []
    header: list[str] = []
    known: set[str] = set()

    for item in items:
        if not isinstance(item, dict):
            return None
        keys = list(item.keys())
        if len(keys) != 1:
            return None
        if list_key is not None and keys[0] != list_key:
            return None
        list_key = keys[0]

        pairs = item[list_key]
        if not isinstance(pairs, list):
            return None

        fields: dict[str, list[str]] = {}
        for pair in pairs:
            if not isinstance(pair, dict):
                return None
            name = pair.get("name")
            if not isinstance(name, str):
                return None
            value_key = next((k for k in pair.keys() if k != "name"), None)
            text = "" if value_key is None else cell_text(pair[value_key])
            # Un nombre puede repetirse (varios teléfonos, varias provincias): se
            # acumulan en la misma columna en lugar de inventar columnas nuevas.
            fields.setdefault(name, []).append(text)
            if name not in known:
                known.add(name)
                header.append(name)
        per_record.append(fields)

    if list_key is None or not header:
        return None

    irregular = 0
    rows: list[list[str]] = []
    for fields in per_record:
        if any(name not in fields for name in header):
            irregular += 1
        rows.append([" · ".join(v for v in fields.get(name, []) if v) for name in header])

    return header, rows, irregular, list_key


def json_to_table(items: list) -> tuple[list[str], list[list[str]], int] | None:
    """Lista de registros -> (cabecera, filas, irregulares)."""
    if not is_tabular_json(items):
        return None
    first = items[0]

    if isinstance(first, list):
        width = 0
        for row in items:
            if isinstance(row, list) and len(row) > width:
                width = len(row)
        header = [f"Columna {i + 1}" for i in range(width)]
        rows = [[cell_text(c) for c in row] if isinstance(row, list) else [] for row in items]
        return header, rows, 0

    header = list(first.keys())
    if not header:
        return None

    irregular = 0
    rows = []
    for item in items:
        if not isinstance(item, dict):
            irregular += 1
            rows.append([cell_text(item)])
            continue
        if any(k not in item for k in header):
            irregular += 1
        rows.append([cell_text(item.get(k)) for k in header])
    return header, rows, irregular


def json_record_table(data) -> tuple[list[str], list[list[str]], int, str] | None:
    """Tabla de los registros del documento, estén donde estén y como estén.

    Devuelve (cabecera, filas, irregulares, ruta) o None si no hay nada tabular.
    """
    found = find_records(data)
    if found is None:
        return None
    items, path = found

    pairs = _name_value_table(items)
    if pairs is not None:
        header, rows, irregular, key = pairs
        return header, rows, irregular, f"{path}[].{key}"

    table = json_to_table(items)
    if table is None:
        return None
    header, rows, irregular = table
    return header, rows, irregular, path
