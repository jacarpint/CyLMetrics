"""
Tests del reconocimiento de números escritos en castellano.

`_NUMBER_LITERAL` solo aceptaba el punto decimal, así que una columna de cifras
como «3632981672,59» se tipaba entera como texto. No era una acusación falsa
—nadie salía señalado— pero sí una detección perdida, y de las que peor sientan
en un portal cuyo oficio es decir qué tipo tiene cada columna: al quedar como
texto tampoco se publicaba su mínimo ni su máximo.

Lo que decide el patrón es la COMA. `1.234` a secas es ambiguo en castellano
—mil doscientos treinta y cuatro, o uno coma doscientos treinta y cuatro— y se
queda fuera; `210.826.129,02` no lo es, porque la coma obliga a leer los puntos
como miles.

Admitir la forma con separador de miles no fue un extra sino una corrección:
con el patrón corto, la columna «Incorporaciones» del presupuesto —que mezcla
`0` con `210.826.129,02`— dejaba ganar a los ceros por 27 a 26 y publicaba las
26 cifras de verdad como valores de tipo incorrecto. O sea, acusaba al organismo
de un defecto que era del patrón.
"""
from __future__ import annotations

import pytest

from src.analysis.formats.tabular import (
    _build_schema_and_sample,
    _check_column_quality,
    _to_number,
    _value_type,
)


@pytest.mark.parametrize(
    "valor",
    [
        "1234,56",
        "3632981672,59",          # sin separador, muchos dígitos
        "-4,683243",              # una longitud GPS
        "+0,5",
        "210.826.129,02",         # con separador de miles
        "7.876,62",
        "1.000,0",
    ],
)
def test_se_reconocen_los_decimales_en_castellano(valor):
    assert _value_type(valor) == "number", f"{valor} no se reconoce como número"


@pytest.mark.parametrize(
    "valor",
    [
        "12.34.56",
        ",5",                     # sin parte entera
        "-,0083333",              # el valor roto de una columna de longitudes real
        "1,",                     # sin decimales
        "1,2,3",
        "Cañada ",
        "3305.06 - 3305.99",      # un rango, no un número
        "",
    ],
)
def test_no_se_reconoce_lo_que_no_es_un_numero_claro(valor):
    assert _value_type(valor) != "number", f"{valor} se toma por número"


@pytest.mark.parametrize("valor", ["1.234", "1.23", "1.2345", "12.345"])
def test_el_punto_sin_coma_no_entra_por_el_patron_nuevo(valor):
    """
    La ambigüedad que el patrón evita, comprobada donde corresponde.

    Estos valores SÍ son números, pero por la regla de siempre —`_NUMBER_LITERAL`
    los lee como decimales con punto, igual que `Number()` en JavaScript— y no
    por el patrón de la coma. La distinción importa: si `_DECIMAL_COMMA` los
    aceptara, `1.234` pasaría a valer mil doscientos treinta y cuatro en unas
    pantallas y uno coma doscientos treinta y cuatro en otras.
    """
    from src.analysis.formats.tabular import _DECIMAL_COMMA

    assert _DECIMAL_COMMA.match(valor) is None, f"{valor} entra por el patrón de la coma"
    assert _value_type(valor) == "number"     # pero sigue siendo número, como antes


def test_1234_con_punto_sigue_valiendo_lo_de_siempre():
    """
    El patrón nuevo no toca al viejo: `1.234` lo sigue leyendo `_NUMBER_LITERAL`
    como número con punto decimal, que es lo que hacía antes de este cambio y lo
    que hace JavaScript. Aquí solo se comprueba que no ha cambiado de tipo por el
    camino.
    """
    assert _value_type("1.234") == "number"
    assert _to_number("1.234") == 1.234


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("1234,56", 1234.56),
        ("210.826.129,02", 210826129.02),
        ("-4,683243", -4.683243),
        ("7.876,62", 7876.62),
        ("42", 42.0),
        ("Cañada", None),
        ("", None),
        (None, None),
        (True, None),             # un booleano no es una cifra que promediar
    ],
)
def test_la_conversion_entiende_lo_mismo_que_la_deteccion(valor, esperado):
    """
    Si `_value_type` dice «número» y `_to_number` no sabe convertirlo, la columna
    se tipa como numérica y se publica SIN rango, que es lo peor de las dos
    opciones. Por eso los dos tienen que entender lo mismo.
    """
    assert _to_number(valor) == esperado


def test_una_columna_de_importes_deja_de_ser_texto():
    """El caso que motivó el cambio, de punta a punta."""
    header = ["concepto", "importe"]
    filas = [
        ["Créditos iniciales", "3632981672,59"],
        ["Ampliaciones", "5500,00"],
        ["Transferencias", "12520686,48"],
        ["Definitivo", "1071494450,92"],
    ]

    schema, _ = _build_schema_and_sample(header, filas)

    importe = schema[1]
    assert importe["type"] == "number"
    assert importe["min"] == 5500.0
    assert importe["max"] == 3632981672.59


def test_una_columna_con_separador_de_miles_no_acusa_a_nadie():
    """
    La regresión concreta: «Incorporaciones» mezcla ceros con importes escritos
    a la española. Con el patrón corto los ceros ganaban la votación y cada
    importe real se marcaba como error de tipo.
    """
    header = ["capitulo", "Incorporaciones"]
    filas = [
        ["1", "0"],
        ["2", "210.826.129,02"],
        ["3", "0"],
        ["4", "86.020.970,21"],
        ["5", "0"],
        ["6", "12.128.005,82"],
    ]

    type_errors, _, type_issue, _ = _check_column_quality(filas, header)

    assert type_errors == 0, f"{type_errors} importes marcados como tipo incorrecto"
    assert type_issue["count"] == 0

    schema, _ = _build_schema_and_sample(header, filas)
    assert schema[1]["type"] == "number"
    assert schema[1]["max"] == 210826129.02


def test_el_valor_roto_de_una_columna_numerica_si_se_marca():
    """
    Y el contrapunto: lo que se gana es precisamente poder señalar el valor
    suelto que no cuadra. `-,0083333` está en una columna de longitudes GPS del
    catálogo, y mientras la columna entera se tipaba como texto no lo veía nadie.
    """
    # La primera columna lleva nombres y no números a propósito: con `str(i)` era
    # ella también una columna numérica con un texto dentro, y sumaba un segundo
    # error de tipo que no tiene nada que ver con lo que aquí se comprueba.
    header = ["punto", "GPS.Longitud"]
    filas = [[f"Punto {i}", f"-4,68{i:04d}"] for i in range(10)]
    filas.append(["Punto roto", "-,0083333"])

    type_errors, _, type_issue, _ = _check_column_quality(filas, header)

    assert type_errors == 1
    assert type_issue["count"] == 1
