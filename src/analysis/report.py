"""Agregación de resultados: informe por dataset + estadísticas globales."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

STATUS_LABEL = {"ok": "ok", "error": "error", "skipped": "skipped"}


def aggregate(results: list[dict]) -> dict:
    by_dataset: dict[str, dict] = {}
    datasets_order: list[str] = []

    for r in results:
        key = f"{r['dataset_index']}|{r['dataset_id']}"
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
            }
            datasets_order.append(key)
        ds = by_dataset[key]
        ds["distributions"] += 1
        ds["distribution_results"].append(r)
        if r["status"] == "ok":
            ds["analyzed"] += 1
            if r["analysis"] and r["analysis"].get("score") is not None:
                ds["scores"].append(r["analysis"]["score"])
        elif r["status"] == "skipped":
            ds["skipped"] += 1
        else:
            ds["failed"] += 1
        if r["analysis"] and r["analysis"].get("issues"):
            for issue in r["analysis"]["issues"]:
                ds["issues_by_code"][issue["code"]] += issue.get("count", 1)

    datasets = []
    for key in datasets_order:
        ds = by_dataset[key]
        ds["score"] = round(sum(ds["scores"]) / len(ds["scores"])) if ds["scores"] else None
        ds["coverage_pct"] = round(ds["analyzed"] / ds["distributions"] * 100) if ds["distributions"] else 0
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
        if r["analysis"] and r["analysis"].get("score") is not None:
            stat["scores"].append(r["analysis"]["score"])
            totals["scores"].append(r["analysis"]["score"])
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
            "avg_score": round(sum(stat["scores"]) / len(stat["scores"]), 1) if stat["scores"] else None,
            "bytes": stat["bytes"],
            "top_issues": dict(stat["issues"].most_common(8)),
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "distributions": len(results),
            "ok": totals["ok"],
            "error": totals["error"],
            "skipped": totals["skipped"],
            "downloaded": totals["downloaded"],
            "avg_score": round(sum(totals["scores"]) / len(totals["scores"]), 1) if totals["scores"] else None,
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
