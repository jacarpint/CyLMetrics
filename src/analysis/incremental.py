"""Análisis incremental: qué datasets hay que analizar y cuáles ya están hechos.

El checkpoint (`analysis.checkpoint.jsonl`) ya reutiliza resultados por URL de
distribución, pero con un criterio ciego: si la URL está, se da por bueno el
resultado anterior. Eso se queda corto en dos sitios que le interesan a quien
vuelve a ejecutar el análisis una temporada después:

  * los datasets NUEVOS que no estaban en la ejecución anterior, y
  * los datasets MODIFICADOS, donde el conjunto de distribuciones cambió (una
    URL nueva, una retirada, o cambió el título o el formato).

Sin fecha de modificación fiable por dataset en el RDF —solo 75 de 825 lo
traen— no se puede saber si un archivo cambió de contenido sin cambiar de URL;
lo que este módulo SÍ detecta de forma fiable es cualquier cambio en la PLANTILLA
de distribuciones de un dataset comparando el catálogo actual con lo ya hecho.

El catálogo es una lista plana de distribuciones (un item por distribución),
cada una con su `dataset_id`, `url`, `format` y `dataset_title`. El checkpoint
guarda el resultado de cada distribución con esos mismos campos. Con eso se
reconstruye, para cada dataset, el conjunto de URLs que ya se analizaron y se
compara con el del catálogo de hoy.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable


def _distribution_fingerprint(item: dict) -> tuple:
    """Lo que identifica a una distribución de un dataset, además de su URL.

    La URL única ya basta para detectar «se añadió» o «se retiró» una
    distribución; el formato y el título se añaden para detectar que un dataset
    existente cambió de aspecto sin cambiar sus URLs.
    """
    return (
        item.get("format", ""),
        (item.get("dataset_title") or "").strip(),
    )


def _dedupe_urls(urls: Iterable[str]) -> dict[str, tuple]:
    """URLs de un dataset indexadas por URL, manteniendo la última firma vista.

    El checkpoint acumula entradas repetidas entre ejecuciones; para comparar
    datasets hace falta una foto única, no un histórico.
    """
    unicas: dict[str, tuple] = {}
    for url in urls:
        unicas[url] = None
    return unicas


def plan_incremental(
    catalog_items: list[dict],
    previous_distributions: Iterable[dict],
) -> dict:
    """Decide qué datasets y qué distribuciones hay que analizar.

    Parámetros:
      catalog_items: la lista plana de distribuciones del catálogo actual
        (lo que devuelve `catalog.iter_distributions`).
      previous_distributions: iterable con los resultados ya analizados (del
        checkpoint o del informe publicado). Se usa solo `dataset_id`, `url`,
        `format` y `dataset_title`.

    Devuelve un dict con:
      new_datasets: lista de dataset_id que no estaban antes.
      changed_datasets: lista de dataset_id que ya estaban pero cuya plantilla
        de distribuciones (URLs, formato o título) cambió.
      force_urls: conjunto de URLs que hay que (re)analizar sí o sí: las de
        todos los datasets nuevos y las de los modificados.
      total_to_analyze: número de distribuciones a analizar.
    """
    # URL -> (dataset_id, firma) de lo ya hecho. Una misma URL no debería
    # aparecer en dos datasets distintos, pero si lo hace, el último gana y se
    # avisa del caso debajo del plan.
    prev_by_url: dict[str, tuple[str, tuple]] = {}
    for prev in previous_distributions:
        url = prev.get("url", "")
        if not url:
            continue
        prev_by_url[url] = (
            prev.get("dataset_id", ""),
            _distribution_fingerprint(prev),
        )

    # dataset_id -> firma de cada distribución ya hecha (la más reciente por URL)
    prev_datasets: dict[str, dict[str, tuple]] = defaultdict(dict)
    for url, (ds_id, firma) in prev_by_url.items():
        prev_datasets[ds_id][url] = firma

    # dataset_id -> firma de cada distribución del catálogo actual
    curr_datasets: dict[str, dict[str, tuple]] = defaultdict(dict)
    for item in catalog_items:
        ds_id = item.get("dataset_id", "")
        url = item.get("url", "")
        curr_datasets[ds_id][url] = _distribution_fingerprint(item)

    new_datasets: list[str] = []
    changed_datasets: list[str] = []
    force_urls: set[str] = set()

    for ds_id, curr_by_url in curr_datasets.items():
        prev_by_url = prev_datasets.get(ds_id)
        if prev_by_url is None:
            # Dataset que no estaba en la ejecución anterior: TODO se analiza.
            new_datasets.append(ds_id)
            force_urls.update(curr_by_url.keys())
            continue

        # Dataset ya visto: comparar plantilla de distribuciones.
        if curr_by_url.keys() != prev_by_url.keys():
            changed_datasets.append(ds_id)
            force_urls.update(curr_by_url.keys())
            continue

        # Mismas URLs: ¿cambiaron formato o título en alguna?
        if any(curr_by_url[url] != prev_by_url[url] for url in curr_by_url):
            changed_datasets.append(ds_id)
            force_urls.update(curr_by_url.keys())
            continue

    return {
        "new_datasets": new_datasets,
        "changed_datasets": changed_datasets,
        "force_urls": force_urls,
        "total_to_analyze": len(force_urls),
    }


def plan_from_checkpoint(catalog_items: list[dict], checkpoint_lines: Iterable[dict]) -> dict:
    """Ídem `plan_incremental` leyendo el checkpoint ya cargado (lista de dicts)."""
    return plan_incremental(catalog_items, (entry.get("result") or {} for entry in checkpoint_lines))


def print_plan(plan: dict, catalog_items: list[dict]) -> None:
    """Línea de diagnóstico legible antes de empezar a analizar."""
    nuevos = plan["new_datasets"]
    modificados = plan["changed_datasets"]
    total_ds = {i.get("dataset_id") for i in catalog_items}
    print("=" * 70, flush=True)
    print("ANÁLISIS INCREMENTAL", flush=True)
    print("=" * 70, flush=True)
    print(
        f"Datasets nuevos: {len(nuevos)} · modificados: {len(modificados)}"
        f" · sin cambios: {len(total_ds) - len(nuevos) - len(modificados)}",
        flush=True,
    )
    print(
        f"Distribuciones a analizar: {plan['total_to_analyze']} de {len(catalog_items)}",
        flush=True,
    )
    if nuevos:
        print(f"  Nuevos: {len(nuevos)}", flush=True)
    if modificados:
        print(f"  Modificados: {len(modificados)}", flush=True)
