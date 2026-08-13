"""Escritura del informe como índice ligero + un fragmento por distribución.

Por qué no un fichero único. El informe anterior era un solo JSON de 16,6 MB
*guardando cinco muestras por incidencia*. Guardándolas todas —que es lo que
hace falta para que el detalle no contradiga al resumen— ese fichero se va a
cientos de megas, y el portal lo lee entero con `JSON.parse` en cada arranque en
frío de la función. En Vercel eso es tiempo de arranque y memoria en TODAS las
páginas, incluidas las que solo necesitan el titular.

El reparto:

  index.json   Todo lo que necesitan la portada, el catálogo y los agregados:
               por distribución, su estado de descarga, su puntuación, sus
               métricas y el RECUENTO de cada incidencia. Sin posiciones.
  d/<id>.json  Un fichero por distribución con lo caro: todas las posiciones de
               cada incidencia, el esquema completo y las filas de muestra. Solo
               se abre al entrar en la ficha de esa distribución.

`<id>` es el sha1 de la URL de la distribución. Se usa la URL y no el índice
porque el informe es una foto y el catálogo está vivo: el día que la Junta
reordene o retire una distribución, un id posicional apuntaría al fragmento de
otro archivo sin dar ninguna señal. Es el mismo criterio que ya usa
`matchDistributions` en `src/lib/quality-report.ts`, y el id se calcula igual en
`shardId()` de `src/lib/report-bundle.ts`.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

#: Versión del formato. La lee `report-bundle.ts` para no interpretar un bundle
#: escrito por una versión que no entiende.
BUNDLE_VERSION = 1

#: Claves de `analysis` que viven SOLO en el fragmento.
_DETAIL_KEYS = ("schema", "sample_rows")

#: Claves de una incidencia que llevan las posiciones y no caben en el índice.
_OCCURRENCE_KEYS = ("columns", "rows")


def shard_id(url: str) -> str:
    """Identificador estable de una distribución a partir de su URL."""
    return hashlib.sha1((url or "").encode("utf-8")).hexdigest()[:16]


def _issue_summary(issue: dict) -> dict:
    """La incidencia sin sus posiciones: código, severidad y cuántas hay."""
    return {k: v for k, v in issue.items() if k not in _OCCURRENCE_KEYS}


def _has_detail(analysis: dict | None) -> bool:
    if not analysis:
        return False
    if any(analysis.get(k) for k in _DETAIL_KEYS):
        return True
    return any(issue.get("stored") for issue in analysis.get("issues") or [])


def _index_result(result: dict) -> dict:
    """Copia de la distribución sin el detalle pesado."""
    entry = dict(result)
    entry["id"] = shard_id(result.get("url") or "")
    analysis = result.get("analysis")
    if analysis:
        slim = {k: v for k, v in analysis.items() if k not in _DETAIL_KEYS}
        slim["issues"] = [_issue_summary(i) for i in analysis.get("issues") or []]
        entry["analysis"] = slim
    entry["has_detail"] = _has_detail(analysis)
    return entry


def _shard(result: dict) -> dict | None:
    """Fragmento de una distribución, o None si no hay nada que guardar."""
    analysis = result.get("analysis")
    if not _has_detail(analysis):
        return None
    metrics = analysis.get("metrics") or {}
    shard: dict = {
        "id": shard_id(result.get("url") or ""),
        "url": result.get("url"),
        "format": result.get("format"),
        "dataset_id": result.get("dataset_id"),
        # La cabecera se guarda UNA vez aquí; las incidencias solo llevan el
        # índice de columna. Repetirla en cada ocurrencia era lo que hacía
        # inviable guardarlas todas.
        "header": metrics.get("header") or [],
        "issues": [i for i in analysis.get("issues") or [] if i.get("stored")],
    }
    for key in _DETAIL_KEYS:
        if analysis.get(key):
            shard[key] = analysis[key]
    return shard


def write_bundle(report: dict, target: Path) -> dict:
    """Escribe `index.json` y `d/*.json`. Devuelve un resumen de lo escrito.

    El directorio de fragmentos se vacía antes de escribir: si no, los
    fragmentos de distribuciones que ya no están en el catálogo se quedarían
    para siempre y el despliegue crecería sin que nada los reclame.
    """
    target.mkdir(parents=True, exist_ok=True)
    shard_dir = target / "d"
    if shard_dir.exists():
        shutil.rmtree(shard_dir)
    shard_dir.mkdir(parents=True, exist_ok=True)

    shards_written = 0
    shard_bytes = 0
    index_datasets = []

    for dataset in report.get("datasets") or []:
        entry = dict(dataset)
        results = []
        for result in dataset.get("distribution_results") or []:
            results.append(_index_result(result))
            shard = _shard(result)
            if shard is None:
                continue
            payload = json.dumps(shard, ensure_ascii=False, separators=(",", ":"))
            (shard_dir / f"{shard['id']}.json").write_text(payload, encoding="utf-8")
            shards_written += 1
            shard_bytes += len(payload.encode("utf-8"))
        entry["distribution_results"] = results
        index_datasets.append(entry)

    index = {
        "bundle_version": BUNDLE_VERSION,
        "generated_at": report.get("generated_at"),
        "source": report.get("source"),
        "totals": report.get("totals"),
        "by_format": report.get("by_format"),
        "datasets": index_datasets,
    }
    index_path = target / "index.json"
    # Sin `indent`: son 2 MB de sangrado que nadie lee y que el servidor tiene
    # que parsear en cada arranque en frío.
    index_path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    return {
        "index_path": index_path,
        "index_bytes": index_path.stat().st_size,
        "shards": shards_written,
        "shard_bytes": shard_bytes,
    }
