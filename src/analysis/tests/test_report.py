"""
Tests de la agregación del informe.

`report.py` tampoco tenía ni un test, y es donde se decidía la nota de contenido
de cada conjunto de datos: el 30% del índice que el portal publica en cada ficha.
Promediaba solo las distribuciones con `status == 'ok'`, y como `engine.py` pone
`status: 'error'` ante cualquier incidencia de severidad error —«tipos mezclados
en una columna» lo es—, la media que mide cómo de limpio está el contenido dejaba
fuera precisamente los archivos con el contenido sucio.

Sobre el informe del 14 de agosto: de las 1.478 distribuciones con nota se
descartaban 533 y, entre ellas, TODAS las que puntúan por debajo de 80. Los 430
conjuntos puntuados salían entre 95 y 100.

El criterio canónico vive en `classifyDelivery` (`src/lib/availability.ts`);
`content_score` lo replica y `portal-limitation-parity.test.ts` vigila que las
listas de códigos no se separen.
"""
from __future__ import annotations


def _dist(status: str, score, codes=(), fetch_status: str = "downloaded") -> dict:
    """Un resultado de distribución con lo que mira la agregación."""
    return {
        "dataset_index": 0,
        "dataset_id": "https://ejemplo.es/ds/1",
        "dataset_title": "Conjunto",
        "format": "CSV",
        "url": f"https://ejemplo.es/{'-'.join(codes) or 'a'}-{score}.csv",
        "status": status,
        "fetch": {"status": fetch_status, "size": 1024, "http_status": 200},
        "analysis": {
            "ok": status == "ok",
            "score": score,
            "summary": "",
            "metrics": {},
            "issues": [
                {"code": c, "label": c, "severity": "error", "count": 1} for c in codes
            ],
        },
    }


# ---------------------------------------------------------------------------
# content_score: qué nota entra en la media y qué nota no
# ---------------------------------------------------------------------------

def test_un_archivo_que_abre_sucio_si_cuenta():
    """El caso exacto del fallo: abre, se lee, y el analizador lo marca en error
    porque el contenido tiene problemas. Esa es justo la nota que hay que medir."""
    from src.analysis.report import content_score

    assert content_score(_dist("error", 20, ["error-tipo"])) == 20


def test_un_archivo_que_no_abre_no_cuenta():
    """Un JSON inválido no tiene contenido que medir: su cero pertenece al eje de
    disponibilidad. Contarlo aquí penalizaría dos veces el mismo hecho."""
    from src.analysis.report import content_score

    assert content_score(_dist("error", 0, ["json-invalido"])) is None


def test_una_limitacion_nuestra_no_cuenta():
    """341 XLSX del informe del 13 de agosto entraron como cero por no tener
    `openpyxl` instalado. Eso mide nuestro entorno, no el archivo."""
    from src.analysis.report import content_score

    assert content_score(_dist("skipped", 0, ["dependencia-faltante"])) is None


def test_una_pagina_web_en_vez_del_archivo_no_cuenta():
    from src.analysis.report import content_score

    assert content_score(_dist("skipped", 0, ["no-es-archivo"])) is None


def test_lo_que_no_se_descargo_no_cuenta():
    from src.analysis.report import content_score

    assert content_score(_dist("error", None, ["descarga"], "http_error")) is None
    assert content_score(_dist("skipped", None, (), "too_large")) is None


def test_un_servicio_ogc_si_cuenta():
    """Un WMS no descarga bytes y su nota sale del análisis de las capacidades:
    juzgarlo por la descarga borraba los 18 servicios del catálogo."""
    from src.analysis.report import content_score

    assert content_score(_dist("ok", 50, (), "service")) == 50


def test_sin_nota_no_hay_nada_que_promediar():
    from src.analysis.report import content_score

    assert content_score(_dist("ok", None)) is None
    assert content_score({"analysis": None, "fetch": {"status": "downloaded"}}) is None


# ---------------------------------------------------------------------------
# aggregate: la nota del conjunto y las medias globales
# ---------------------------------------------------------------------------

def test_la_nota_del_conjunto_refleja_el_archivo_sucio():
    """
    Regresión del fallo. Un conjunto con un CSV limpio (100) y otro con tipos
    mezclados (20) tiene que salir 60. Antes salía 100: el sucio quedaba fuera de
    su propia media por llevar `status: 'error'`.
    """
    from src.analysis.report import aggregate

    report = aggregate([_dist("ok", 100), _dist("error", 20, ["error-tipo"])])
    assert report["datasets"][0]["score"] == 60, report["datasets"][0]["score"]


def test_la_nota_del_conjunto_ignora_lo_que_no_abre():
    from src.analysis.report import aggregate

    report = aggregate([_dist("ok", 90), _dist("error", 0, ["json-invalido"])])
    assert report["datasets"][0]["score"] == 90


def test_sin_nada_legible_la_nota_es_nula_y_no_cero():
    """Null y no cero: la ausencia la interpreta `compositeScore` en TypeScript,
    que solo la cuenta como cero si el conjunto sí se llegó a comprobar."""
    from src.analysis.report import aggregate

    report = aggregate([_dist("error", None, ["descarga"], "http_error")])
    assert report["datasets"][0]["score"] is None


def test_la_media_global_no_promedia_lo_que_no_abre():
    """
    `totals.avg_score` promediaba toda nota no nula y daba 79,9 mientras la
    portada publicaba 90,3 para lo que dice ser lo mismo. Dos cifras del mismo
    hecho, las dos públicas.
    """
    from src.analysis.report import aggregate

    report = aggregate([
        _dist("ok", 100),
        _dist("error", 0, ["json-invalido"]),   # no abre: fuera
        _dist("skipped", 0, ["dependencia-faltante"]),  # nuestro: fuera
    ])
    assert report["totals"]["avg_score"] == 100


def test_la_media_por_formato_sigue_el_mismo_criterio():
    """De aquí salía el «XLSX: avg_score 0» del informe del 13 de agosto, a partir
    de 341 ceros que no medían ningún Excel."""
    from src.analysis.report import aggregate

    sucio = _dist("error", 60, ["error-tipo"])
    sin_lector = _dist("skipped", 0, ["dependencia-faltante"])
    sin_lector["format"] = sucio["format"] = "XLSX"
    report = aggregate([sucio, sin_lector])
    assert report["by_format"]["XLSX"]["avg_score"] == 60


def test_los_conjuntos_se_agrupan_por_id_y_no_por_posicion():
    """
    El índice es la posición en el catálogo del día, y el catálogo está vivo. Al
    reanudar desde un checkpoint los resultados reutilizados llevan el índice
    viejo, así que agrupar por `dataset_index|dataset_id` partía un mismo conjunto
    en dos: pasó con 330 de 822 en la ejecución del 14 de agosto.
    """
    from src.analysis.report import aggregate

    viejo = _dist("ok", 100)
    nuevo = _dist("ok", 80)
    nuevo["dataset_index"] = 47  # mismo id, otra posición
    report = aggregate([viejo, nuevo])
    assert len(report["datasets"]) == 1, [d["dataset_id"] for d in report["datasets"]]
    assert report["datasets"][0]["distributions"] == 2


# ---------------------------------------------------------------------------
# Redondeo: Python y el navegador tienen que dar la misma cifra
# ---------------------------------------------------------------------------

def test_redondea_como_el_navegador_y_no_como_python():
    """
    `round()` de Python va al par —`round(92.5)` da 92— y `Math.round` sube
    siempre —da 93—. El portal deriva en TypeScript la nota que se ve, así que
    era el informe el que se separaba de lo publicado: 22 conjuntos de 831 con un
    punto de diferencia. Se ajusta Python al navegador porque el navegador es
    quien pinta la cifra.
    """
    from src.analysis.report import round_half_up

    # Los casos en los que los dos lenguajes discrepan.
    assert round_half_up(92.5) == 93
    assert round_half_up(0.5) == 1
    assert round_half_up(2.5) == 3
    # Y los que ya coincidían, que no deben cambiar.
    assert round_half_up(1.5) == 2
    assert round_half_up(92.4) == 92
    assert round_half_up(92.6) == 93
    assert round_half_up(0) == 0


def test_redondea_igual_con_decimales():
    from src.analysis.report import round_half_up

    assert round_half_up(90.35, 1) == 90.4  # Python daría 90.3
    assert round_half_up(90.34, 1) == 90.3
    assert round_half_up(90.0, 1) == 90.0


def test_la_nota_del_conjunto_usa_ese_redondeo():
    """No basta con tener el helper: la agregación tiene que llamarlo."""
    from src.analysis.report import aggregate

    # Media de 85 y 100 = 92,5. Al par daría 92; hacia arriba, 93.
    report = aggregate([_dist("ok", 85), _dist("ok", 100)])
    assert report["datasets"][0]["score"] == 93
