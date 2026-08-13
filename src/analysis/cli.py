"""CLI del análisis de calidad de datos.

Ejemplos:
  python -m src.analysis --limit 0                     # todas las distribuciones
  python -m src.analysis --limit 25                    # primeras 25
  python -m src.analysis --only-formats CSV,XLSX,SHP   # solo ciertos formatos
  python -m src.analysis --limit 0 --workers 16 --output reports/data-analysis.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .bundle import write_bundle
from .catalog import iter_distributions, load_catalog_xml
from .engine import run_analysis
from .report import aggregate, print_summary

DEFAULT_BUNDLE = Path("reports") / "current"
#: Tope de descarga. Eran 25 MB, y con él 129 distribuciones se archivaban como
#: «no se comprobó» y otras se analizaban a medias: las cifras de esos ficheros
#: salían de su primer trozo. El análisis se ejecuta en local y sin límite de
#: tiempo, así que el tope solo está para que un enlace a un raster de decenas
#: de gigas no bloquee la ejecución entera.
DEFAULT_SIZE_CAP = 512 * 1024 * 1024  # 512 MB
# Sin muestreo propio para CSV/TXT: antes se cortaban en 5 MB y el esquema, los
# valores distintos y los rangos salían de esa muestra, no del fichero. Ahora
# comparten el tope general de descarga, así que solo se recorta lo que de
# verdad supera --size-cap (y esos casos quedan marcados como truncados).
DEFAULT_CSV_SAMPLE = DEFAULT_SIZE_CAP


def main(argv: list[str] | None = None) -> int:
    # Salida robusta a consola (Windows cp1252): evita UnicodeEncodeError
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Análisis de calidad de los datos del catálogo jcyl")
    parser.add_argument("--input", default=None, help="Ruta al RDF local (si no, se descarga el catálogo)")
    parser.add_argument("--url", default=None, help="URL del catálogo RDF")
    parser.add_argument("--limit", type=int, default=0, help="Máximo de distribuciones a analizar (0 = todas)")
    parser.add_argument("--workers", type=int, default=8, help="Descargas concurrentes")
    parser.add_argument("--size-cap", type=int, default=DEFAULT_SIZE_CAP, help="Tope de descarga en bytes (512 MB por defecto)")
    parser.add_argument("--csv-sample", type=int, default=DEFAULT_CSV_SAMPLE,
                        help="Tope de descarga para CSV/TXT (por defecto, el mismo que --size-cap)")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout de lectura por descarga (segundos)")
    parser.add_argument("--retries", type=int, default=2, help="Reintentos por distribución")
    parser.add_argument("--output", default=str(DEFAULT_BUNDLE),
                        help="Directorio del informe (index.json + d/*.json)")
    parser.add_argument("--legacy-output", default=None,
                        help="Además, escribir el informe completo en un único JSON (formato antiguo)")
    parser.add_argument("--checkpoint", default=None,
                        help="Ruta del checkpoint JSONL para reanudar un análisis a medias (por defecto: reports/checkpoint.jsonl si --output es el default)")
    parser.add_argument("--progress-every", type=int, default=25, help="Línea de avance cada N distribuciones")
    parser.add_argument("--quiet", action="store_true",
                        help="No mostrar la línea de detalle por archivo (inicio/fin de cada descarga)")
    parser.add_argument("--only-formats", default=None, help="Solo estos formatos (coma, ej: CSV,XLSX)")
    args = parser.parse_args(argv)

    # Checkpoint junto al informe: ahora `--output` es un directorio, así que el
    # checkpoint va dentro y no como hermano con otra extensión.
    out_path = Path(args.output)
    checkpoint_path = Path(args.checkpoint) if args.checkpoint else out_path / "analysis.checkpoint.jsonl"
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)

    xml_bytes, source_label = load_catalog_xml(args.input, args.url)
    items = iter_distributions(xml_bytes)
    print(f"Catálogo: {len(items)} distribuciones · {source_label}", flush=True)

    if args.only_formats:
        wanted = {f.strip().upper() for f in args.only_formats.split(",")}
        items = [i for i in items if i["format"] in wanted]
        print(f"Filtrados a formatos {sorted(wanted)}: {len(items)} distribuciones", flush=True)

    if args.limit:
        items = items[: args.limit]
        print(f"Limitado a las primeras {len(items)} distribuciones", flush=True)

    if checkpoint_path.exists():
        lines = sum(1 for _ in open(checkpoint_path, encoding="utf-8") if _.strip())
        print(f"Reanudando desde checkpoint: {checkpoint_path} ({lines} resultados previos, "
              f"{len(items) - lines} pendientes)", flush=True)

    results = run_analysis(
        items,
        workers=args.workers,
        size_cap=args.size_cap,
        sample_cap=args.csv_sample,
        timeout=args.timeout,
        retries=args.retries,
        progress_every=args.progress_every,
        checkpoint=checkpoint_path,
        verbose=not args.quiet,
    )

    report = aggregate(results)
    report["source"] = {"url": source_label, "generated_at": report["generated_at"]}
    print_summary(report)

    written = write_bundle(report, out_path)
    print(
        f"\nInforme guardado en: {out_path}"
        f"\n  index.json      {written['index_bytes'] / 1e6:.1f} MB"
        f"\n  d/*.json        {written['shards']} fragmentos · {written['shard_bytes'] / 1e6:.1f} MB"
    )

    if args.legacy_output:
        legacy = Path(args.legacy_output)
        legacy.parent.mkdir(parents=True, exist_ok=True)
        legacy.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        print(f"  formato antiguo {legacy} ({legacy.stat().st_size / 1e6:.1f} MB)")

    print("\nSiguiente paso: npm run reports:snapshots (actualiza la pestaña Evolución)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
