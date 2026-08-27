"""
Tests de tres defectos que NO están en el informe publicado.

Los tres se dispararían con datos que el catálogo hoy no tiene, y ninguno da la
cara en las cifras actuales. Se fijan igual, porque son exactamente el tipo de
fallo que aparece el día que la Junta publica un archivo distinto y que entonces
no se atribuye a un error nuestro sino al organismo:

  - `binary.py` no reconocía JSON —comparaba cinco bytes con literales de dos y
    tres— y `filetype` tampoco lo reconoce, así que un JSON válido publicado como
    BIN se archivaba como «tipo no identificado», error y puntuación 0.
  - `shapefile.py` fijaba `ok = True` y no volvía a tocarlo, dejando inalcanzable
    la rama del resumen para paquetes defectuosos: un shapefile sin features se
    describiría como «SHP válido: 0 features» con puntuación 0.
  - la extracción del ZIP no tenía tope de descompresión, el que sí tiene el lado
    TypeScript desde el caso de 299 KB → 300 MB.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from src.analysis.formats.binary import analyze_binary
from src.analysis.formats.shapefile import (
    INFLATE_RATIO,
    MAX_INFLATED,
    MIN_INFLATED,
    _inflate_cap,
    analyze_zip_shapefile,
)

CTX: dict = {"declared_format": "BIN"}


def _archivo(tmp_path: Path, nombre: str, contenido: bytes) -> Path:
    ruta = tmp_path / nombre
    ruta.write_bytes(contenido)
    return ruta


# --- binary.py: la rama de JSON era inalcanzable ---------------------------


@pytest.mark.parametrize(
    "contenido",
    [
        b'{"municipio": "Penafiel", "habitantes": 1234}',
        b'[{"id": 1}, {"id": 2}]',
        b'\xef\xbb\xbf{"con": "BOM"}',
        b'  \n {"con": "espacios delante"}',
    ],
)
def test_un_json_publicado_como_bin_no_se_acusa_de_roto(tmp_path, contenido):
    """
    Lo que importa no es que ponga «json» sino que NO se publique como roto.

    `filetype` no reconoce JSON —es texto, no tiene firma binaria—, así que sin la
    heurística de prefijo el archivo caía en el último `return`: código
    `tipo-no-identificado`, severidad error y puntuación 0 para un archivo
    perfectamente correcto.
    """
    resultado = analyze_binary(_archivo(tmp_path, "dato.bin", contenido), dict(CTX))

    codigos = [i["code"] for i in resultado["issues"]]
    assert "tipo-no-identificado" not in codigos
    assert resultado["score"] and resultado["score"] > 0
    assert resultado["metrics"]["detected"]["extension"] == "json"


def test_un_xml_publicado_como_bin_sigue_reconociendose(tmp_path):
    """El XML era el único que colaba, por dar cinco bytes justos. No debe perderse."""
    resultado = analyze_binary(
        _archivo(tmp_path, "dato.bin", b'<?xml version="1.0"?><r/>'), dict(CTX)
    )

    assert resultado["metrics"]["detected"]["extension"] == "xml"


def test_un_binario_que_empieza_por_llave_no_pasa_por_json(tmp_path):
    """
    `{` es el byte 0x7B y puede abrir cualquier binario por casualidad.

    Sin la comprobación de que el contenido es texto, la heurística de prefijo
    afirmaría «json» sobre datos que no lo son, que es el error contrario y
    tampoco vale.
    """
    binario = b"{\x00\x01\x02\x03rubbish\xff\xfe" + bytes(range(32))

    resultado = analyze_binary(_archivo(tmp_path, "dato.bin", binario), dict(CTX))

    detectado = resultado["metrics"].get("detected") or {}
    assert detectado.get("extension") != "json"


# --- shapefile.py: el tope de descompresión --------------------------------


def test_el_tope_de_descompresion_no_castiga_a_los_paquetes_grandes():
    """
    El primer tope que escribí eran 512 MB absolutos, y el catálogo tiene
    shapefiles de 648 MB COMPRIMIDOS que descomprimidos son varios gigas de
    `.dbf` legítimo. Habría cambiado una vulnerabilidad teórica por dejar sin
    analizar las capas más grandes de la comunidad.
    """
    assert _inflate_cap(648 * 1024 * 1024) > 8 * 1024 * 1024 * 1024 - 1  # llega al techo
    assert _inflate_cap(100 * 1024 * 1024) == 100 * 1024 * 1024 * INFLATE_RATIO
    # Un ZIP diminuto no se queda sin margen...
    assert _inflate_cap(1024) == MIN_INFLATED
    # ...y nada supera el techo de disco.
    assert _inflate_cap(10 * MAX_INFLATED) == MAX_INFLATED


def test_una_bomba_de_descompresion_se_para_y_no_se_llama_roto(tmp_path):
    """
    Y se para SIN acusar al publicador.

    El código es `paquete-desproporcionado`, severidad aviso y puntuación `None`:
    está en `PORTAL_LIMITATION_CODES` porque el paquete puede estar perfecto y lo
    único que sabemos es que no lo hemos abierto. Marcarlo como error de contenido
    penalizaría al organismo por un tope nuestro.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 400 MB de ceros comprimen a unos cientos de KB: proporción ~1000×,
        # el orden del caso documentado en `zip-read.ts`.
        zf.writestr("capa.shp", b"\x00" * (400 * 1024 * 1024))
    paquete = _archivo(tmp_path, "bomba.zip", buf.getvalue())
    ratio = (400 * 1024 * 1024) / paquete.stat().st_size
    assert ratio > INFLATE_RATIO, f"el fixture no es una bomba (proporción {ratio:.0f}×)"

    resultado = analyze_zip_shapefile(paquete, {})

    assert [i["code"] for i in resultado["issues"]] == ["paquete-desproporcionado"]
    assert resultado["issues"][0]["severity"] == "warning"
    assert resultado["score"] is None, "una limitación nuestra no puede puntuar el archivo"


def test_un_zip_normal_se_extrae_entero(tmp_path):
    """El tope no puede estorbar a un paquete de proporción corriente."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Texto variado: comprime poco, como un .dbf de verdad.
        contenido = bytes(range(256)) * 4096  # 1 MB incompresible
        zf.writestr("capa.shp", contenido)
        zf.writestr("capa.dbf", contenido)
    paquete = _archivo(tmp_path, "normal.zip", buf.getvalue())

    resultado = analyze_zip_shapefile(paquete, {})

    codigos = [i["code"] for i in resultado["issues"]]
    assert "paquete-desproporcionado" not in codigos


def test_el_codigo_nuevo_esta_en_las_dos_tablas():
    """
    La sincronización entre analizador e interfaz es manual, así que un código
    nuevo que solo esté en un lado se comporta distinto en cada mitad del portal.
    """
    from src.analysis.checks import PORTAL_LIMITATION_CODES

    assert "paquete-desproporcionado" in PORTAL_LIMITATION_CODES
    ts = Path("src/lib/quality-labels.ts").read_text(encoding="utf-8")
    assert "'paquete-desproporcionado'" in ts, "falta en PORTAL_LIMITATION_CODES de TypeScript"
