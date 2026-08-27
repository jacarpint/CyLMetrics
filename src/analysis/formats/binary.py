"""Análisis de archivos binarios genéricos (BIN/OTRO): firma y tipo real."""
from __future__ import annotations

from pathlib import Path

from ..checks import is_ecw, is_jpeg, looks_like_html, sniff_magic
from .tabular import _normalize


def _looks_textual(data: bytes) -> bool:
    """
    ¿Esto es texto y no un binario que empieza por la llave de casualidad?

    Hace falta porque `{` y `[` son un byte cualquiera —0x7B y 0x5B— y un binario
    puede empezar por ellos sin ser JSON. Se piden dos cosas que un binario no
    suele cumplir: nada de bytes nulos, y ningún carácter de control aparte de
    tabulador, salto y retorno.
    """
    if b"\x00" in data:
        return False
    return not any(b < 0x20 and b not in (0x09, 0x0A, 0x0D) for b in data)


def analyze_binary(path: Path, ctx: dict) -> dict:
    declared = ctx.get("declared_format", "BIN")
    size = path.stat().st_size
    magic = sniff_magic(path, 1024)
    detected = None
    try:
        import filetype

        guess = filetype.guess(magic)
        if guess is not None:
            detected = {"extension": guess.extension, "mime": guess.mime}
    except ImportError:
        pass

    if detected is None and looks_like_html(path):
        detected = {"extension": "html", "mime": "text/html", "html": True}

    issues: list[dict] = []
    if detected is None:
        # Heurísticas básicas de firma
        if is_jpeg(path):
            detected = {"extension": "jpg", "mime": "image/jpeg"}
        elif is_ecw(path):
            detected = {"extension": "ecw", "mime": "application/ecw"}
        elif magic[:4] == b"PK\x03\x04":
            detected = {"extension": "zip", "mime": "application/zip"}
        else:
            # Por PREFIJO, no por igualdad con un trozo de longitud fija.
            #
            # Antes era `magic[:5] in (b"<?xml", b'{"', b'[{"')`, y `magic[:5]`
            # son siempre cinco bytes: ninguno de los dos literales de JSON,
            # de dos y tres bytes, podía igualarlo nunca. La rama de JSON era
            # inalcanzable y solo colaba el XML, que da 5 justos por casualidad.
            #
            # No es cosmético: `filetype` no reconoce ni JSON ni XML —son texto,
            # no tienen firma binaria—, así que un JSON válido publicado como BIN
            # se iba al último `return` y se PUBLICABA como «tipo de archivo no
            # identificado», error y puntuación 0. Es decir, acusábamos de roto un
            # archivo perfectamente correcto. No hay ningún caso en el informe
            # actual (8 distribuciones BIN/OTRO, ninguna con ese código), pero
            # llegaría el día que la Junta publique un JSON sin declarar formato.
            head = magic.lstrip(b"\xef\xbb\xbf").lstrip()
            if head.startswith(b"<?xml"):
                detected = {"extension": "xml", "mime": "text/xml"}
            elif head[:1] in (b"{", b"[") and _looks_textual(magic):
                detected = {"extension": "json", "mime": "application/json"}

    if detected:
        if detected.get("html"):
            summary = f"Archivo binario ({declared}) es una página HTML (directorio/landing), {size/1e6:.2f} MB"
            issues.append({
                "code": "no-es-archivo",
                "label": "El contenido descargado es HTML, no el tipo declarado",
                "severity": "error",
                "count": 1,
            })
            return _normalize(path, ctx, False, 0, summary,
                              {"size_bytes": size, "detected": detected, "declared": declared}, issues)
        summary = f"Archivo binario ({declared}) identificado como {detected['extension']} ({detected['mime']}), {size/1e6:.2f} MB"
        if declared in ("BIN", "OTRO"):
            issues.append({
                "code": "tipo-detectado",
                "label": f"El contenido real parece ser {detected['extension']}, no {declared}",
                "severity": "warning",
                "count": 1,
            })
            score = 80
        else:
            score = 100 if detected["extension"].lower() == declared.lower() else 60
        return _normalize(path, ctx, True, score, summary,
                          {"size_bytes": size, "detected": detected, "declared": declared}, issues)

    return _normalize(path, ctx, False, 0,
                      f"BIN ({declared}): tipo de archivo no identificado ({size/1e6:.2f} MB)", {"size_bytes": size},
                      [{"code": "tipo-no-identificado", "label": "No se pudo identificar el tipo de archivo", "severity": "error", "count": 1}])
