"""
Tests de detección de codificación.

Cubren un defecto que estuvo publicado: `detect_encoding` dejaba que
`charset-normalizer` eligiera entre las ~90 codificaciones que conoce Python, y
para el castellano prefería **cp1250** —la centroeuropea— sobre cp1252. Las dos
decodifican el mismo archivo sin un solo error, y solo discrepan en unos pocos
bytes; el 0xF1 es «ñ» en cp1252 y «ń» en cp1250.

Por eso pasó desapercibido tanto tiempo: la lectura equivocada no produce el
carácter de reemplazo (U+FFFD) que delata a un encoding mal elegido, sino una
letra perfectamente válida del polaco. El informe publicado traía 259
distribuciones leídas como cp1250 y 156 fragmentos con caracteres imposibles en
castellano, con topónimos como «Peńafiel» en las filas de muestra.
"""
from __future__ import annotations

import pytest

from src.analysis.checks import PLAUSIBLE_ENCODINGS, detect_encoding

CABECERA = "municipio;provincia;habitantes\n"
#: Los cinco acentos del castellano más la eñe y la diéresis. La eñe es la que
#: separa cp1252 de cp1250; el resto coinciden y no desempatan nada.
FILAS = "Peñafiel;Valladolid;1234\nLeón;León;124000\nÁvila;Ávila;58000\nCigüeñuela;Segovia;40\n"


def _texto(repeticiones: int = 200) -> str:
    return CABECERA + FILAS * repeticiones


@pytest.mark.parametrize("codificacion", ["cp1252", "iso-8859-1", "iso-8859-15", "utf-8"])
def test_un_csv_castellano_se_lee_sin_corromperse(codificacion):
    """
    El invariante que importa no es «acierta el nombre» sino «el texto vuelve
    entero».

    Se comprueba así a propósito: cp1252 e iso-8859-1 son intercambiables para
    este contenido y exigir un nombre concreto sería un test frágil que falla
    por un empate legítimo. Lo que no puede pasar es que «Peñafiel» se convierta
    en otra cosa.
    """
    original = _texto()
    data = original.encode(codificacion)

    detectada = detect_encoding(data)

    assert data.decode(detectada, errors="replace") == original, (
        f"leído como {detectada}, el texto no sobrevive"
    )


@pytest.mark.parametrize("codificacion", ["cp1252", "iso-8859-1"])
def test_nunca_se_elige_una_codificacion_centroeuropea(codificacion):
    """
    El caso concreto que se publicó, fijado como regresión.

    Sin acotar el conjunto de candidatas esto devuelve `cp1250` y la eñe se
    convierte en «ń» sin que nada avise.
    """
    data = _texto().encode(codificacion)

    detectada = detect_encoding(data)

    assert "1250" not in detectada, "vuelve la detección centroeuropea"
    assert "ñ" in data.decode(detectada, errors="replace")


def test_solo_se_consideran_codificaciones_del_catalogo():
    """
    Nada de japonés ni de islandés en un catálogo de Castilla y León.

    El informe publicado llegó a traer `shift_jis_2004`, `cp932`, `mac_iceland`
    y `cp775`, que para estos archivos solo pueden ser un error de detección.
    """
    for prohibida in ("shift_jis", "cp932", "mac_iceland", "cp775", "cp1250", "cp1257"):
        assert prohibida not in PLAUSIBLE_ENCODINGS


def test_el_bom_manda_sobre_la_heuristica():
    """
    Un BOM no se adivina: es el que escribió el archivo diciendo en qué lo
    escribió.

    Importa devolver `utf_8_sig` y no `utf_8` porque este último deja el BOM
    dentro del texto, y acaba pegado al primer nombre de columna: «﻿municipio»
    en el esquema publicado.
    """
    data = _texto(3).encode("utf-8-sig")

    detectada = detect_encoding(data)

    texto = data.decode(detectada)
    assert not texto.startswith("﻿"), f"{detectada} deja el BOM dentro del texto"
    assert texto.startswith("municipio")


def test_utf16_se_reconoce_por_su_bom():
    """Es lo que sale de un «guardar como texto Unicode» en Excel."""
    original = _texto(3)

    for codificacion in ("utf-16", "utf-16-le", "utf-16-be"):
        data = original.encode(codificacion)
        detectada = detect_encoding(data)
        assert data.decode(detectada).lstrip("﻿") == original, (
            f"{codificacion} leído como {detectada}"
        )


def test_un_utf8_con_pocos_acentos_no_pierde_contra_la_heuristica():
    """
    Un UTF-8 válido gana siempre, y no por preferencia: UTF-8 se autovalida.

    Con 164 bytes casi todos ASCII y una sola «ñ», `charset-normalizer` devolvía
    `cp1252` —lectura también válida byte a byte— y el archivo se publicaba con
    «Ã±». La detección estadística necesita volumen para desempatar y un archivo
    con dos acentos no se lo da; que los bytes formen secuencias UTF-8 correctas,
    en cambio, es prueba y no indicio.
    """
    texto = "a" * 63 + "ñ" + "b" * 100
    data = texto.encode("utf-8")

    detectada = detect_encoding(data)

    assert data.decode(detectada, errors="replace") == texto, f"leído como {detectada}"


def test_un_utf8_cortado_a_media_letra_sigue_siendo_utf8():
    """
    Es el caso real de `--size-cap`: la descarga se corta donde toca, no en una
    frontera de carácter.

    Sin holgura para los bytes sueltos del final, un CSV de 512 MB perfectamente
    UTF-8 se leería como latin-1 —que traga cualquier byte— entero, por culpa de
    medio carácter del borde.
    """
    # Acaba en «ñ» a propósito: quitando un byte, el corte cae DENTRO del último
    # carácter en vez de limitarse a comerse un salto de línea.
    completo = ("Peñafiel;León;Ávila\n" * 500 + "ñ").encode("utf-8")
    cortado = completo[:-1]
    with pytest.raises(UnicodeDecodeError):
        cortado.decode("utf-8")  # confirma que la trama queda partida de verdad

    detectada = detect_encoding(cortado)

    assert detectada.replace("_", "-") == "utf-8", f"leído como {detectada}"


def test_un_latin1_de_verdad_no_se_confunde_con_utf8():
    """
    El contrapunto del test anterior: la preferencia por UTF-8 no puede tragarse
    lo que no lo es.

    En cp1252 «Peñafiel» pone un 0xF1 suelto, que en UTF-8 sería el arranque de
    una secuencia de cuatro bytes y no cuadra con lo que viene detrás.
    """
    data = ("Peñafiel;León;Ávila\n" * 500).encode("cp1252")

    detectada = detect_encoding(data)

    assert "utf" not in detectada.lower()
    assert data.decode(detectada, errors="replace") == data.decode("cp1252")


def test_sin_charset_normalizer_sigue_funcionando(monkeypatch):
    """El respaldo tiene que valerse solo: la librería es opcional en la práctica."""
    import builtins

    real_import = builtins.__import__

    def sin_libreria(name, *args, **kwargs):
        if name == "charset_normalizer":
            raise ImportError("simulado")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", sin_libreria)

    assert detect_encoding("hola qué tal".encode("utf-8")) in ("utf-8", "utf_8")


def test_bytes_vacios_no_revientan():
    """Un archivo de 0 bytes llega hasta aquí; devolver algo es mejor que fallar."""
    assert detect_encoding(b"")
