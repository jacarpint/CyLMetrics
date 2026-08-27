"""
Reconstruye los resultados completos a partir de un informe ya publicado.

Para qué. `write_bundle` reparte cada distribución entre `index.json` (estado,
puntuación, métricas y recuento de incidencias) y `d/<id>.json` (esquema, filas
de muestra y posiciones). El reparto no pierde nada, solo separa, así que el
resultado original se puede volver a montar juntando las dos mitades.

Con eso, corregir un defecto del analizador no obliga a descargar otra vez los
23 GB del catálogo: se re-analiza solo lo que el defecto afectaba y el resto se
reutiliza del informe anterior. El primer caso real fue la detección de
codificación, que leía 259 distribuciones como cp1250 y publicaba «Peńafiel».

La reconstrucción se puede COMPROBAR, y conviene hacerlo antes de confiar en
ella: `verify_roundtrip()` reconstruye, vuelve a agregar y vuelve a escribir el
bundle, y compara el resultado con el publicado. Si el ciclo no devuelve
exactamente lo mismo, la reconstrucción se está inventando algo y no hay que
usarla.
"""
from __future__ import annotations

import json
from pathlib import Path

#: Claves que añade `_index_result` y que no estaban en el resultado original.
_ADDED_BY_INDEX = ("id", "has_detail")

#: Claves de `analysis` que solo viven en el fragmento.
_DETAIL_KEYS = ("schema", "sample_rows")

#: Claves de una incidencia que solo viven en el fragmento.
_OCCURRENCE_KEYS = ("columns", "rows")


def load_results(bundle: Path) -> list[dict]:
    """
    Todos los resultados del informe, montados y en el orden original.

    El orden importa: `aggregate` agrupa por conjunto según lo va recorriendo, y
    los índices de distribución de la interfaz —los slugs `/csv`, `/csv-2`— salen
    de esa posición.
    """
    index = json.loads((bundle / "index.json").read_text(encoding="utf-8"))
    shard_dir = bundle / "d"

    results: list[dict] = []
    for dataset in index.get("datasets") or []:
        for entry in dataset.get("distribution_results") or []:
            results.append(_rebuild(entry, shard_dir))
    return results


def _rebuild(entry: dict, shard_dir: Path) -> dict:
    """Une la mitad ligera de `index.json` con la mitad pesada del fragmento."""
    result = {k: v for k, v in entry.items() if k not in _ADDED_BY_INDEX}

    analysis = result.get("analysis")
    if not entry.get("has_detail") or not isinstance(analysis, dict):
        return result

    shard_path = shard_dir / f"{entry['id']}.json"
    if not shard_path.exists():
        # Puede pasar legítimamente: `_empty_shard_dir` avisa de los fragmentos
        # que no pudo borrar, y un bundle a medias es posible. Se devuelve lo que
        # hay en lugar de fallar; lo que se pierde es detalle, no estado.
        return result

    shard = json.loads(shard_path.read_text(encoding="utf-8"))

    for key in _DETAIL_KEYS:
        if key in shard:
            analysis[key] = shard[key]

    # Emparejamiento por código de incidencia. Es seguro porque el analizador
    # agrupa las ocurrencias por código antes de guardarlas: comprobado sobre el
    # informe publicado, ninguna de las 1.683 distribuciones repite código.
    stored = {i.get("code"): i for i in shard.get("issues") or []}
    for issue in analysis.get("issues") or []:
        original = stored.get(issue.get("code"))
        if original is None:
            continue
        for key in _OCCURRENCE_KEYS:
            if key in original:
                issue[key] = original[key]

    return result


def write_checkpoint(bundle: Path, path: Path, skip_urls: set[str]) -> dict[str, int]:
    """
    Escribe un checkpoint con los resultados del informe MENOS `skip_urls`.

    Es la pieza que convierte «corregir el analizador» en algo asequible: las URL
    que se dejan fuera son las únicas que `run_analysis` volverá a descargar, y
    todo lo demás se reutiliza tal cual. Para la corrección de la detección de
    codificación fueron 324 distribuciones y 9 GB en vez de 1.683 y 23,9 GB.

    El fichero se escribe con `w`, no con `append`: un checkpoint resembrado tiene
    que ser exactamente lo que se le pide, y `run_analysis` ya lo abrirá en modo
    añadir para lo que analice de nuevo.

    Conviene pasarle una ruta FUERA de una carpeta sincronizada. Con el
    checkpoint dentro de OneDrive, los `append` empezaron a devolver `OSError
    [Errno 22]` al crecer y se perdieron resultados sin que el análisis se
    enterase; está contado en `_append_checkpoint`.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    guardados = omitidos = 0
    with open(path, "w", encoding="utf-8") as fh:
        for result in load_results(bundle):
            url = result.get("url") or ""
            if url in skip_urls:
                omitidos += 1
                continue
            fh.write(json.dumps({"url": url, "result": result}, ensure_ascii=False) + "\n")
            guardados += 1
    return {"guardados": guardados, "omitidos": omitidos}


def verify_roundtrip(bundle: Path, scratch: Path) -> list[str]:
    """
    Reconstruye → agrega → escribe, y compara con el informe publicado.

    Devuelve la lista de diferencias; vacía significa que el ciclo es fiel y que
    la reconstrucción se puede usar como base de un re-análisis parcial.

    `generated_at` se excluye a propósito: `aggregate` lo pone al momento de
    ejecutarse, así que cambia siempre y no dice nada del contenido.
    """
    from .bundle import write_bundle
    from .report import aggregate

    original_index = json.loads((bundle / "index.json").read_text(encoding="utf-8"))

    results = load_results(bundle)
    report = aggregate(results)
    report["source"] = original_index.get("source")
    write_bundle(report, scratch)

    diffs: list[str] = []
    nuevo_index = json.loads((scratch / "index.json").read_text(encoding="utf-8"))
    for clave in ("bundle_version", "totals", "by_format", "source"):
        if nuevo_index.get(clave) != original_index.get(clave):
            diffs.append(f"index.{clave} no coincide")

    viejos = original_index.get("datasets") or []
    nuevos = nuevo_index.get("datasets") or []
    if len(viejos) != len(nuevos):
        diffs.append(f"conjuntos: {len(viejos)} -> {len(nuevos)}")
    else:
        for v, n in zip(viejos, nuevos):
            if v != n:
                diffs.append(f"conjunto {v.get('dataset_id')} no coincide")

    viejos_frag = {p.name: p.read_bytes() for p in (bundle / "d").glob("*.json")}
    nuevos_frag = {p.name: p.read_bytes() for p in (scratch / "d").glob("*.json")}
    if set(viejos_frag) != set(nuevos_frag):
        faltan = set(viejos_frag) - set(nuevos_frag)
        sobran = set(nuevos_frag) - set(viejos_frag)
        diffs.append(f"fragmentos: faltan {len(faltan)}, sobran {len(sobran)}")
    for nombre, contenido in viejos_frag.items():
        if nombre in nuevos_frag and nuevos_frag[nombre] != contenido:
            diffs.append(f"fragmento {nombre} no coincide")

    return diffs
