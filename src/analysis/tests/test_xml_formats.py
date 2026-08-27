"""
Tests de los analizadores XML (XML, RSS, KML, RDF, GML).

Tres cosas que se corrigieron aquí:

  - `_basic` hacía su propio `_parse(path)` aunque todos los que la llaman ya
    habían parseado el documento para contar sus entidades: cada archivo XML del
    catálogo se parseaba dos veces.
  - `sin-entidades` se declaraba `warning` y se puntuaba 0. Como no es un código
    bloqueante, ese 0 entra en la media de calidad del conjunto; y como la tabla
    de archivos corregibles filtra por severidad `error`, el archivo quedaba
    penalizado y a la vez invisible.
  - GML solo contaba `featureMember`/`featureMembers`, de GML 3.1. Un GML de un
    servicio WFS 2.0 usa `member` y se publicaba como «sin features».
"""
from __future__ import annotations

from pathlib import Path

import pytest

from src.analysis.formats import xml_formats
from src.analysis.formats.xml_formats import analyze_gml, analyze_kml, analyze_rdf, analyze_rss

RSS = """<?xml version="1.0"?>
<rss version="2.0"><channel><title>Avisos</title>
<item><title>Uno</title></item><item><title>Dos</title></item>
</channel></rss>"""

GML_31 = """<?xml version="1.0"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml">
  <gml:featureMember><capa><gml:Point><gml:coordinates>1,2</gml:coordinates></gml:Point></capa></gml:featureMember>
  <gml:featureMember><capa><gml:Point><gml:coordinates>3,4</gml:coordinates></gml:Point></capa></gml:featureMember>
</wfs:FeatureCollection>"""

GML_32 = """<?xml version="1.0"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2">
  <wfs:member><capa><gml:Point><gml:pos>1 2</gml:pos></gml:Point></capa></wfs:member>
  <wfs:member><capa><gml:Point><gml:pos>3 4</gml:pos></gml:Point></capa></wfs:member>
  <wfs:member><capa><gml:Point><gml:pos>5 6</gml:pos></gml:Point></capa></wfs:member>
</wfs:FeatureCollection>"""

KML_VACIO = """<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Sin nada</name></Document></kml>"""


def _archivo(tmp_path: Path, nombre: str, texto: str) -> Path:
    ruta = tmp_path / nombre
    ruta.write_text(texto, encoding="utf-8")
    return ruta


def test_gml_32_no_se_publica_como_vacio(tmp_path):
    """
    Un GML de WFS 2.0 usa `member`, no `featureMember`.

    Contando solo la forma de GML 3.1, un archivo correcto salía con cero
    features, puntuación 0 y «sin features detectados»: acusado de venir vacío
    por usar la versión nueva del estándar.
    """
    resultado = analyze_gml(_archivo(tmp_path, "capa.gml", GML_32), {})

    assert resultado["metrics"]["features"] == 3
    assert resultado["score"] == 100
    assert [i["code"] for i in resultado["issues"]] == []


def test_gml_31_sigue_contando_igual(tmp_path):
    """El añadido no puede cambiar el recuento de los que usan la forma antigua."""
    resultado = analyze_gml(_archivo(tmp_path, "capa.gml", GML_31), {})

    assert resultado["metrics"]["features"] == 2
    assert resultado["metrics"]["geometries"] == 2


def test_sin_entidades_es_error_y_no_aviso(tmp_path):
    """
    La severidad tiene que casar con la puntuación que se aplica.

    Con `warning` y puntuación 0, el archivo bajaba la media de calidad del
    conjunto pero no aparecía en la tabla de archivos corregibles de `/calidad`,
    que se construye filtrando `severity === 'error'`. Sus equivalentes exactos
    —`sin-datos` de Excel, `sin-features` de shapefile— ya son `error`.
    """
    resultado = analyze_kml(_archivo(tmp_path, "vacio.kml", KML_VACIO), {})

    vacio = next(i for i in resultado["issues"] if i["code"] == "sin-entidades")
    assert vacio["severity"] == "error"
    assert resultado["score"] == 0


def test_el_documento_se_parsea_una_sola_vez(tmp_path, monkeypatch):
    """
    Lo que se arregló no se nota en el resultado, solo en el coste: hay que
    contar las llamadas.

    Cada analizador parseaba para contar entidades y luego `_basic` volvía a
    parsear el mismo fichero, así que todo el catálogo XML pagaba el doble de
    tiempo y de memoria a cambio de nada.
    """
    llamadas = {"n": 0}
    real = xml_formats._parse

    def contando(path):
        llamadas["n"] += 1
        return real(path)

    monkeypatch.setattr(xml_formats, "_parse", contando)

    analyze_rss(_archivo(tmp_path, "avisos.rss", RSS), {})

    assert llamadas["n"] == 1, f"el documento se parseó {llamadas['n']} veces"


def test_rss_cuenta_sus_items(tmp_path):
    """Comprobación de que pasar el root ya parseado no cambia el resultado."""
    resultado = analyze_rss(_archivo(tmp_path, "avisos.rss", RSS), {})

    assert resultado["metrics"]["items"] == 2
    assert resultado["metrics"]["channel"] is True
    assert resultado["score"] == 100


def test_un_xml_roto_sigue_dando_su_error(tmp_path):
    """La vía de reparación no debe romperse al reorganizar `_basic`."""
    resultado = analyze_rdf(_archivo(tmp_path, "malo.rdf", "<rdf><sin cerrar>"), {})

    assert [i["code"] for i in resultado["issues"]] == ["xml-no-bien-formado"]
    assert resultado["score"] == 0


def test_un_xml_reparable_se_marca_como_reparado(tmp_path):
    """
    El `&` sin escapar es el caso más común del catálogo («Diseño & Publicidad»),
    y la nota de reparación tiene que sobrevivir al cambio de firma: `recovered`
    ya no lo recalcula `_basic`, se lo pasa quien parseó.
    """
    roto = '<?xml version="1.0"?><rss version="2.0"><channel><item><title>Diseño & Publicidad</title></item></channel></rss>'

    resultado = analyze_rss(_archivo(tmp_path, "amp.rss", roto), {})

    codigos = [i["code"] for i in resultado["issues"]]
    assert "xml-reparado" in codigos, f"se perdió la nota de reparación: {codigos}"
    assert resultado["metrics"]["items"] == 1
