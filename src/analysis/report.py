"""Agregación de resultados: informe por dataset + estadísticas globales."""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timezone

from .checks import (
    BLOCKING_ISSUE_CODES,
    PORTAL_LIMITATION_CODES,
    PUBLICATION_DEFECT_CODES,
)

STATUS_LABEL = {"ok": "ok", "error": "error", "skipped": "skipped"}

#: Estados de descarga en los que el archivo llegó (o no había nada que bajar).
#:
#: `service` está dentro a propósito: un WMS/WFS no descarga bytes y su análisis
#: sale de las capacidades, así que juzgarlo por la descarga lo daría por roto.
_DELIVERED_FETCH = frozenset({"downloaded", "truncated", "service"})

#: Todo lo que impide que haya contenido legible que medir.
_UNREADABLE_CODES = BLOCKING_ISSUE_CODES | PORTAL_LIMITATION_CODES | PUBLICATION_DEFECT_CODES


def round_half_up(value: float, decimals: int = 0) -> float:
    """
    Redondear como lo hace el navegador, no como lo hace Python.

    `round()` de Python redondea al par: `round(92.5)` da 92, y `round(0.5)` da 0.
    `Math.round` de JavaScript sube siempre: 93 y 1. El portal deriva la nota que
    se ve en TypeScript, así que era el informe el que se separaba de lo
    publicado —22 conjuntos de 831 con un punto de diferencia—, y una paridad que
    falla en el 3% de los casos no se puede afirmar en un test.

    Se ajusta Python al navegador y no al revés, porque el navegador es quien
    pinta la cifra.
    """
    factor = 10 ** decimals
    escalado = value * factor
    # `floor(x + 0.5)` es exactamente «medio hacia arriba». Para negativos habría
    # que reflejarlo, pero aquí no hay notas ni porcentajes por debajo de cero.
    redondeado = math.floor(escalado + 0.5) if escalado >= 0 else -math.floor(-escalado + 0.5)
    return redondeado / factor if decimals else int(redondeado)


def content_score(result: dict) -> float | None:
    """
    La nota de contenido de una distribución que SÍ se abre, o None.

    Es el criterio que decide qué entra en la media de un conjunto de datos, y
    replica el de `classifyDelivery` en `src/lib/availability.ts`, que es donde
    vive la definición canónica.

    Antes esta media se calculaba con `r["status"] == "ok"` a secas, y ahí estaba
    el fallo: `engine.py` pone `status: "error"` ante CUALQUIER incidencia de
    severidad error, y «tipos mezclados en una columna» es una de ellas. O sea
    que toda distribución con el contenido regular quedaba fuera de la media que
    precisamente mide cómo de regular es el contenido.

    El efecto sobre el informe del 14 de agosto: de las 1.478 distribuciones con
    nota, 533 se descartaban, y entre ellas **todas** las que puntúan por debajo
    de 80. Los 430 conjuntos con nota salían entre 95 y 100, así que el eje no
    separaba a nadie de nadie. Es el mismo error que `classifyDelivery` ya había
    corregido para el eje de disponibilidad, un nivel más abajo.
    """
    analysis = result.get("analysis")
    if not analysis:
        return None
    score = analysis.get("score")
    if score is None:
        return None
    if (result.get("fetch") or {}).get("status") not in _DELIVERED_FETCH:
        return None
    codes = {i.get("code") for i in analysis.get("issues", [])}
    if codes & _UNREADABLE_CODES:
        return None
    return score


def aggregate(results: list[dict]) -> dict:
    by_dataset: dict[str, dict] = {}
    datasets_order: list[str] = []

    for r in results:
        # Se agrupa por `dataset_id` A SECAS, no por `dataset_index|dataset_id`.
        #
        # El índice es la posición en el catálogo del día, y el catálogo está vivo:
        # basta con que la Junta publique un conjunto nuevo para que todos los
        # índices posteriores se desplacen. Al reanudar desde un checkpoint, los
        # resultados reutilizados llevan el índice viejo y los recién analizados el
        # nuevo, así que un mismo dataset se partía en dos grupos con el mismo id.
        # Ocurrió: en la ejecución del 14 de agosto salieron 1.153 grupos para 822
        # datasets reales, 330 partidos. Y como la interfaz indexa por el slug del
        # `dataset_id` (`reportBySlug` en `quality-report.ts`) y en un `Map` gana la
        # última entrada, esos 330 conjuntos habrían mostrado solo parte de sus
        # archivos sin que nada avisara.
        #
        # Es el mismo criterio que ya sigue `bundle.py` para nombrar los fragmentos
        # por la URL y no por el índice: «el informe es una foto y el catálogo está
        # vivo». `dataset_index` se conserva como dato informativo, del primer
        # resultado que se vea.
        key = r["dataset_id"]
        if key not in by_dataset:
            by_dataset[key] = {
                "dataset_index": r["dataset_index"],
                "dataset_id": r["dataset_id"],
                "dataset_title": r["dataset_title"],
                "distributions": 0,
                "analyzed": 0,
                "failed": 0,
                "skipped": 0,
                "scores": [],
                "distribution_results": [],
                "issues_by_code": Counter(),
                # La severidad de cada código, que `issues_by_code` no puede
                # llevar. Sin esto, quien solo tiene el agregado (el desglose de
                # la portada, la clasificación de alertas) suma errores con
                # avisos y presenta como «errores» un millón de celdas vacías.
                "issue_severity": {},
            }
            datasets_order.append(key)
        ds = by_dataset[key]
        ds["distributions"] += 1
        ds["distribution_results"].append(r)
        # La nota entra si el archivo ABRE, no si el analizador lo dio por bueno:
        # son dos preguntas distintas y `content_score` explica por qué mezclarlas
        # dejaba la media sin ninguna nota por debajo de 80.
        score = content_score(r)
        if score is not None:
            ds["scores"].append(score)
        if r["status"] == "ok":
            ds["analyzed"] += 1
        elif r["status"] == "skipped":
            ds["skipped"] += 1
        else:
            ds["failed"] += 1
        if r["analysis"] and r["analysis"].get("issues"):
            for issue in r["analysis"]["issues"]:
                ds["issues_by_code"][issue["code"]] += issue.get("count", 1)
                # Un código es de error si lo es en alguna distribución: nunca
                # se degrada a aviso por haberse visto también como aviso.
                if issue.get("severity") == "error" or issue["code"] not in ds["issue_severity"]:
                    ds["issue_severity"][issue["code"]] = issue.get("severity", "error")

    datasets = []
    for key in datasets_order:
        ds = by_dataset[key]
        ds["score"] = round_half_up(sum(ds["scores"]) / len(ds["scores"])) if ds["scores"] else None
        ds["coverage_pct"] = round_half_up(ds["analyzed"] / ds["distributions"] * 100) if ds["distributions"] else 0
        ds["issues_by_code"] = dict(ds["issues_by_code"].most_common())
        datasets.append(ds)

    # Estadísticas globales por formato
    by_format: dict[str, dict] = defaultdict(lambda: {"total": 0, "ok": 0, "error": 0, "skipped": 0,
                                                      "downloaded": 0, "scores": [], "bytes": 0,
                                                      "issues": Counter()})
    totals = {"downloaded": 0, "ok": 0, "error": 0, "skipped": 0, "scores": [], "bytes": 0}

    for r in results:
        fmt = r["format"]
        stat = by_format[fmt]
        stat["total"] += 1
        stat[STATUS_LABEL.get(r["status"], "error")] += 1
        totals[STATUS_LABEL.get(r["status"], "error")] += 1
        fetch = r.get("fetch") or {}
        if fetch.get("status") in ("downloaded", "truncated"):
            stat["downloaded"] += 1
            totals["downloaded"] += 1
        size = fetch.get("size") or 0
        stat["bytes"] += size
        totals["bytes"] += size
        # Mismo criterio que la media por conjunto de datos. Antes esto promediaba
        # toda nota no nula, así que `totals.avg_score` (79,9) contradecía al
        # 90,3 % que publica la portada, que sí mide solo lo que abre; y
        # `by_format` daba «XLSX: 0» a partir de 341 ceros que no medían ningún
        # Excel, sino que no teníamos openpyxl instalado.
        fmt_score = content_score(r)
        if fmt_score is not None:
            stat["scores"].append(fmt_score)
            totals["scores"].append(fmt_score)
        if r["analysis"] and r["analysis"].get("issues"):
            for issue in r["analysis"]["issues"]:
                stat["issues"][issue["code"]] += issue.get("count", 1)

    by_format_summary = {}
    for fmt, stat in sorted(by_format.items(), key=lambda kv: -kv[1]["total"]):
        by_format_summary[fmt] = {
            "total": stat["total"],
            "ok": stat["ok"],
            "error": stat["error"],
            "skipped": stat["skipped"],
            "downloaded": stat["downloaded"],
            "avg_score": round_half_up(sum(stat["scores"]) / len(stat["scores"]), 1) if stat["scores"] else None,
            "bytes": stat["bytes"],
            # Todos los códigos, no los 8 más frecuentes: el recorte dejaba
            # fuera del resumen por formato incidencias que sí existían y solo
            # se podían encontrar entrando dataset por dataset.
            "top_issues": dict(stat["issues"].most_common()),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "distributions": len(results),
            "ok": totals["ok"],
            "error": totals["error"],
            "skipped": totals["skipped"],
            "downloaded": totals["downloaded"],
            "avg_score": round_half_up(sum(totals["scores"]) / len(totals["scores"]), 1) if totals["scores"] else None,
            "bytes": totals["bytes"],
        },
        "by_format": by_format_summary,
        "datasets": datasets,
    }


def print_summary(report: dict) -> None:
    t = report["totals"]
    print("=" * 70)
    print("ANALISIS DE CALIDAD DE DATOS - RESUMEN")
    print("=" * 70)
    print(f"Distribuciones: {t['distributions']}  ok={t['ok']}  err={t['error']}  skip={t['skipped']}")
    print(f"Descargadas: {t['downloaded']} | {t['bytes'] / 1e6:.1f} MB | score medio (analizables): {t['avg_score']}")
    print("\nPor formato:")
    for fmt, s in report["by_format"].items():
        print(f"  {fmt:<7} total={s['total']:<4} ok={s['ok']:<4} err={s['error']:<4} "
              f"skip={s['skipped']:<4} score={s['avg_score']}")
