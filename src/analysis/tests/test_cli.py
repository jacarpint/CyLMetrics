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


def test_el_interprete_para_la_expansion_de_entidades():
    """
    La defensa contra «billion laughs» no está en este código: la pone el
    intérprete.

    El analizador abre XML que descarga de Internet con
    `xml.etree.ElementTree`. Desde Python 3.12 un documento con entidades
    anidadas rebota con «limit on input amplification factor breached»; en
    versiones anteriores se expande, y 400 bytes se convierten en gigas.

    Este test no comprueba el número de versión sino el COMPORTAMIENTO, porque es
    lo que importa y depende también de la libexpat con la que se construyó el
    intérprete. Si falla, el entorno no sirve para analizar el catálogo por mucho
    que estén todos los lectores.
    """
    from src.analysis.cli import _entity_protection_works

    assert _entity_protection_works() is True


def test_check_deps_rechaza_un_interprete_sin_esa_defensa(monkeypatch):
    """Y no se limita a avisar: aborta, igual que con un lector que falta."""
    import src.analysis.cli as cli

    monkeypatch.setattr(cli, "_entity_protection_works", lambda: False)
    assert cli.main(["--check-deps"]) == 2


def test_las_entidades_externas_tampoco_se_resuelven():
    """
    El otro ataque clásico: `<!ENTITY x SYSTEM "file:///...">`.

    Aquí importa más de lo normal porque el contenido de los ficheros llega al
    informe —esquema, filas de muestra— y el informe se publica. Una entidad
    externa resuelta sería un fichero local del que analiza acabando en GitHub.
    """
    import tempfile
    import xml.etree.ElementTree as ET
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        secreto = Path(tmp) / "secreto.txt"
        secreto.write_text("CONTENIDO-CONFIDENCIAL", encoding="utf-8")
        ruta = secreto.as_posix()
        xxe = f'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///{ruta}">]><r><d>&x;</d></r>'
        try:
            root = ET.fromstring(xxe)
            assert "CONFIDENCIAL" not in "".join(root.itertext())
        except ET.ParseError:
            pass  # No la resuelve, que es lo que se busca.
