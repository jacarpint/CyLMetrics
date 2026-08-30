"""Tests del análisis incremental.

`incremental.py` decide qué datasets hay que (re)analizar comparando el
catálogo de hoy contra lo ya analizado (checkpoint). Los casos que importan:

  * un dataset NUEVO hay que analizarlo entero;
  * un dataset con una distribución NUEVA hay que reanalizarlo;
  * un dataset con una distribución RETIRADA hay que reanalizarlo;
  * un dataset con MISMAS URLs pero distinto título o formato hay que
    reanalizarlo (cambió de aspecto);
  * un dataset intacto NO se vuelve a tocar.
"""
from __future__ import annotations


def _item(ds_id: str, url: str, fmt: str = "CSV", title: str = "Conjunto") -> dict:
    return {
        "dataset_index": 0,
        "dataset_id": ds_id,
        "dataset_title": title,
        "format": fmt,
        "mime": "",
        "url": url,
    }


def _prev(url: str, ds_id: str = "https://ejemplo.es/ds/1",
          fmt: str = "CSV", title: str = "Conjunto") -> dict:
    return {
        "url": url,
        "dataset_id": ds_id,
        "dataset_title": title,
        "format": fmt,
        "status": "ok",
    }


def test_un_dataset_nuevo_se_analiza_entero():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv")]
    ahora = [
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv"),
        _item("https://ejemplo.es/ds/2", "https://ejemplo.es/ds/2/b.csv"),
    ]
    plan = plan_incremental(ahora, antes)
    assert plan["new_datasets"] == ["https://ejemplo.es/ds/2"]
    assert plan["changed_datasets"] == []
    assert plan["force_urls"] == {"https://ejemplo.es/ds/2/b.csv"}
    assert plan["total_to_analyze"] == 1


def test_una_distribucion_nueva_en_un_dataset_lo_marca_modificado():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv")]
    ahora = [
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv"),
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/b.csv"),
    ]
    plan = plan_incremental(ahora, antes)
    assert plan["new_datasets"] == []
    assert plan["changed_datasets"] == ["https://ejemplo.es/ds/1"]
    # Se reanalizan TODAS sus distribuciones, no solo la nueva
    assert plan["force_urls"] == {"https://ejemplo.es/ds/1/a.csv", "https://ejemplo.es/ds/1/b.csv"}


def test_una_distribucion_retirada_lo_marca_modificado():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv"), _prev("https://ejemplo.es/ds/1/b.csv")]
    ahora = [_item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv")]
    plan = plan_incremental(ahora, antes)
    assert plan["changed_datasets"] == ["https://ejemplo.es/ds/1"]
    assert plan["force_urls"] == {"https://ejemplo.es/ds/1/a.csv"}


def test_cambio_de_titulo_con_mismas_urls_marca_modificado():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv", title="Viejo")]
    ahora = [_item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv", title="Nuevo")]
    plan = plan_incremental(ahora, antes)
    assert plan["changed_datasets"] == ["https://ejemplo.es/ds/1"]
    assert plan["force_urls"] == {"https://ejemplo.es/ds/1/a.csv"}


def test_cambio_de_formato_con_mismas_urls_marca_modificado():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv", fmt="CSV")]
    ahora = [_item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv", fmt="XLSX")]
    plan = plan_incremental(ahora, antes)
    assert plan["changed_datasets"] == ["https://ejemplo.es/ds/1"]


def test_un_dataset_intacto_no_se_toca():
    from src.analysis.incremental import plan_incremental

    antes = [_prev("https://ejemplo.es/ds/1/a.csv"), _prev("https://ejemplo.es/ds/1/b.csv")]
    ahora = [
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv"),
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/b.csv"),
    ]
    plan = plan_incremental(ahora, antes)
    assert plan["new_datasets"] == []
    assert plan["changed_datasets"] == []
    assert plan["force_urls"] == set()
    assert plan["total_to_analyze"] == 0


def test_el_checkpoint_acumulado_no_enturbia_la_comparacion():
    """El checkpoint acumula duplicados entre ejecuciones; la comparación por
    URL debe tratarlos como una sola foto, no como cambios."""
    from src.analysis.incremental import plan_incremental

    antes = [
        _prev("https://ejemplo.es/ds/1/a.csv"),
        _prev("https://ejemplo.es/ds/1/a.csv"),  # duplicado de otra ejecución
        _prev("https://ejemplo.es/ds/1/b.csv"),
    ]
    ahora = [
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv"),
        _item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/b.csv"),
    ]
    plan = plan_incremental(ahora, antes)
    assert plan["changed_datasets"] == []
    assert plan["force_urls"] == set()


def test_plan_from_checkpoint_extrae_el_result():
    from src.analysis.incremental import plan_from_checkpoint

    lineas = [{"url": "https://ejemplo.es/ds/1/a.csv", "result": _prev("https://ejemplo.es/ds/1/a.csv")}]
    ahora = [_item("https://ejemplo.es/ds/1", "https://ejemplo.es/ds/1/a.csv"),
             _item("https://ejemplo.es/ds/9", "https://ejemplo.es/ds/9/z.csv")]
    plan = plan_from_checkpoint(ahora, lineas)
    assert plan["force_urls"] == {"https://ejemplo.es/ds/9/z.csv"}
