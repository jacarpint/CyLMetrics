"""
Tests del descargador.

`downloader.py` no tenía ni un test, y es la primera pieza que toca cada una de
las 1.662 distribuciones del catálogo: lo que decida aquí es lo que el portal
publica como «este archivo no se puede descargar». El fallo que motiva este
fichero llevaba meses en producción.
"""
from __future__ import annotations


class _FakeResponse:
    """
    Lo mínimo que mira `get_redirect_target`.

    Las cabeceras llegan ya decodificadas como latin-1, que es lo que hace el
    módulo `http` de la biblioteca estándar; por eso el valor se construye así y
    no como bytes.
    """

    def __init__(self, location: bytes | None, is_redirect: bool = True):
        self.headers = {} if location is None else {"location": location.decode("latin-1")}
        self.is_redirect = is_redirect


def test_location_con_byte_crudo_no_revienta():
    """
    El caso real: diez CSV de Educación redirigen a
    `transparencia.jcyl.es/educacion/JCYLEducación_Estudios_2022.csv` con la `ó`
    en un solo byte `0xf3` en vez de percent-encoded.

    `requests.Session.get_redirect_target` hace `.encode('latin1').decode('utf8')`
    y lanza `UnicodeDecodeError` antes de descargar nada, así que los diez se
    archivaban como «No se pudo descargar» —un fallo que el portal atribuye al
    organismo— cuando el archivo llega con HTTP 200 y 817 KB.
    """
    from src.analysis.downloader import RedirectSafeSession

    crudo = b"https://transparencia.jcyl.es/educacion/JCYLEducaci\xf3n_Estudios_2022.csv"
    target = RedirectSafeSession().get_redirect_target(_FakeResponse(crudo))

    assert target == (
        "https://transparencia.jcyl.es/educacion/JCYLEducaci%F3n_Estudios_2022.csv"
    ), target
    # Y sobre todo: que no queden bytes altos sin escapar en la URL resultante.
    assert target.isascii()


def test_location_bien_formado_no_se_toca():
    """
    Una redirección normal tiene que salir idéntica.

    Es la comprobación que protege a las otras 1.652 distribuciones: el arreglo
    solo debe actuar cuando la cabecera viene mal.
    """
    from src.analysis.downloader import RedirectSafeSession

    normal = b"https://datosabiertos.jcyl.es/web/jcyl/risp/es/salud/x.csv?a=1&b=2"
    assert RedirectSafeSession().get_redirect_target(_FakeResponse(normal)) == normal.decode()


def test_location_en_utf8_se_decodifica_como_utf8():
    """
    Un `Location` con acentos en UTF-8 bien formado se decodifica, no se escapa:
    es lo que hace `requests` y lo que espera el servidor que lo envió así.
    """
    from src.analysis.downloader import RedirectSafeSession

    utf8 = "https://ejemplo.es/Educación.csv".encode("utf-8")
    assert RedirectSafeSession().get_redirect_target(_FakeResponse(utf8)) == (
        "https://ejemplo.es/Educación.csv"
    )


def test_sin_redireccion_no_hay_destino():
    from src.analysis.downloader import RedirectSafeSession

    session = RedirectSafeSession()
    assert session.get_redirect_target(_FakeResponse(b"https://ejemplo.es/", is_redirect=False)) is None


def test_un_fallo_de_decodificacion_no_es_culpa_del_origen():
    """
    Si aun así se cuela un `UnicodeDecodeError`, el estado tiene que ser `error`
    y no `unreachable`.

    Los dos hacen fracasar la descarga, pero significan cosas distintas:
    `unreachable` señala al servidor y en el portal se lee como «no se puede
    descargar», mientras que `error` está documentado en `/api` como «el análisis
    de este portal se interrumpió, es un problema nuestro» y queda fuera del
    recuento de archivos rotos.
    """
    import tempfile
    from pathlib import Path

    import src.analysis.downloader as downloader

    class SesionQueFalla(downloader.RedirectSafeSession):
        def get(self, *args, **kwargs):  # type: ignore[override]
            raise UnicodeDecodeError("utf-8", b"\xf3", 0, 1, "invalid continuation byte")

        def head(self, *args, **kwargs):  # type: ignore[override]
            raise UnicodeDecodeError("utf-8", b"\xf3", 0, 1, "invalid continuation byte")

    original = downloader.RedirectSafeSession
    downloader.RedirectSafeSession = SesionQueFalla  # type: ignore[misc]
    try:
        with tempfile.TemporaryDirectory() as tmp:
            result = downloader.fetch(
                "https://ejemplo.es/x.csv", Path(tmp), cap_bytes=1_000_000, timeout=1, retries=0
            )
    finally:
        downloader.RedirectSafeSession = original  # type: ignore[misc]

    assert result.status == "error", result.status
    assert "no pudo leer la respuesta" in result.note, result.note
