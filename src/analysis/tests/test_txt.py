"""
Tests del analizador de TXT.

El defecto que cubren: `analyze_txt` adivinaba codificación y delimitador con los
primeros 2 MB —correcto— pero además CONTABA las líneas sobre esa misma muestra y
publicaba la cifra como si fuese la del archivo. Cualquier TXT de más de 2 MB
declaraba las líneas de su principio como su total.

Es el mismo patrón que ya se había corregido en `excel.py` (2.000 filas de 3
hojas frente a un `total_rows` del libro entero) y en `shapefile.py` (2.000
geometrías frente a un recuento global de features). Aquí no llegó a publicarse
porque los dos únicos TXT de texto libre del catálogo tienen 24 líneas.
"""
from __future__ import annotations

from pathlib import Path

from src.analysis.formats.tabular import analyze_txt


def _txt(tmp_path: Path, texto: str, *, encoding: str = "utf-8") -> Path:
    ruta = tmp_path / "libre.txt"
    ruta.write_text(texto, encoding=encoding)
    return ruta


def test_cuenta_las_lineas_del_archivo_entero(tmp_path):
    """
    Un TXT de texto libre de más de 2 MB: la cifra tiene que ser la suya, no la
    de su primer trozo.
    """
    # Líneas largas sin delimitador, para que no se tome por tabular. 3 MB.
    linea = "Resolución de la Consejería sobre el expediente número " + "X" * 200 + "\n"
    total = (3 * 1024 * 1024) // len(linea.encode("utf-8")) + 1
    ruta = _txt(tmp_path, linea * total)
    assert ruta.stat().st_size > 2_000_000, "el fixture no supera la muestra"

    resultado = analyze_txt(ruta, {})

    assert resultado["metrics"]["kind"] == "text"
    assert resultado["metrics"]["lines"] == total, (
        f"cuenta {resultado['metrics']['lines']} de {total}: sigue midiendo la muestra"
    )
    assert f"{total:,}" in resultado["summary"]


def test_las_lineas_vacias_no_cuentan(tmp_path):
    """Como antes: lo que se cuenta son líneas con algo dentro."""
    ruta = _txt(tmp_path, "Una línea\n\n   \nOtra línea\n\n")

    assert analyze_txt(ruta, {})["metrics"]["lines"] == 2


def test_un_txt_vacio_se_marca_sin_contenido(tmp_path):
    """El caso límite tras cambiar la condición de `not lines` a `lines == 0`."""
    ruta = _txt(tmp_path, "\n\n   \n")

    resultado = analyze_txt(ruta, {})

    assert [i["code"] for i in resultado["issues"]] == ["sin-contenido"]
    assert resultado["score"] == 0


def test_un_txt_con_delimitador_sigue_yendo_por_la_via_tabular(tmp_path):
    """El reparto entre tabular y texto libre no lo toca este cambio."""
    ruta = _txt(tmp_path, "municipio;provincia\nPeñafiel;Valladolid\nLeón;León\n")

    resultado = analyze_txt(ruta, {})

    assert resultado["metrics"]["kind"] == "tabular"
    assert resultado["summary"].startswith("TXT tabular:")


def test_las_enes_se_leen_bien_en_un_txt_cp1252(tmp_path):
    """
    De paso, el arreglo de la detección de codificación llega también aquí: el
    recuento de líneas abre el archivo con la codificación detectada, así que
    equivocarla lo rompería.
    """
    ruta = _txt(tmp_path, "Peñafiel es un municipio de la provincia de Valladolid\n" * 50,
                encoding="cp1252")

    resultado = analyze_txt(ruta, {})

    assert resultado["metrics"]["lines"] == 50
    assert "1250" not in resultado["metrics"]["encoding"]
