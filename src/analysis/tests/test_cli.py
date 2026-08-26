"""
Tests del CLI.

Uno solo, pero paga su sitio: la «comprobación previa» que documentaban el
README, `requirements-analysis.txt` y el propio docstring del CLI era
`--limit 1 --strict-deps`, y tiene un efecto que nadie espera de algo que se
presenta como una comprobación. `--output` vale `reports/current` por defecto —el
informe que publica el portal—, así que analizaba una distribución y sobrescribía
el informe entero con esa única distribución: de 1.187 fragmentos a 1.

Pasó de verdad, al ir a regenerar el informe siguiendo las instrucciones. Solo se
recuperó porque `reports/current` está versionado.
"""
from __future__ import annotations

import json
from pathlib import Path

BUNDLE = Path("reports") / "current"


def test_check_deps_no_escribe_nada():
    """La comprobación de entorno no puede tocar el informe publicado."""
    from src.analysis.cli import main

    index = BUNDLE / "index.json"
    antes_shards = len(list((BUNDLE / "d").glob("*.json"))) if (BUNDLE / "d").is_dir() else 0
    antes_index = index.read_bytes() if index.exists() else None

    assert main(["--check-deps"]) == 0

    despues_shards = len(list((BUNDLE / "d").glob("*.json"))) if (BUNDLE / "d").is_dir() else 0
    assert despues_shards == antes_shards, "la comprobación ha borrado o añadido fragmentos"
    if antes_index is not None:
        assert index.read_bytes() == antes_index, "la comprobación ha reescrito index.json"


def test_check_deps_no_descarga_el_catalogo(monkeypatch):
    """
    Y tampoco pide nada por la red.

    Es lo que la separa de `--limit 1`: comprobar el entorno no debería costar ni
    una petición. Si `load_catalog_xml` se llegara a invocar, este test falla.
    """
    import src.analysis.cli as cli

    def no_pasar(*_args, **_kwargs):
        raise AssertionError("--check-deps no debe descargar el catálogo")

    monkeypatch.setattr(cli, "load_catalog_xml", no_pasar)
    assert cli.main(["--check-deps"]) == 0


def test_el_informe_publicado_sigue_siendo_coherente():
    """
    Guardia del artefacto de despliegue.

    Si una ejecución de prueba lo sobrescribe, `index.json` se queda con un puñado
    de distribuciones y el portal se despliega sin datos. Un informe del catálogo
    completo tiene cientos de conjuntos; con menos, algo lo ha pisado.
    """
    index = BUNDLE / "index.json"
    if not index.exists():
        return  # no hay informe publicado en este árbol: nada que comprobar

    report = json.loads(index.read_text(encoding="utf-8"))
    assert len(report["datasets"]) > 100, (
        f"solo {len(report['datasets'])} conjuntos en el informe publicado: "
        "parece que una ejecución de prueba lo ha sobrescrito"
    )
    assert report["totals"]["distributions"] > 100
