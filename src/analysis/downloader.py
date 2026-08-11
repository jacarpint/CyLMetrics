"""Descarga segura de distribuciones: tope de tamaño, timeout, reintentos.

Estrategia:
  - HEAD previo para conocer Content-Length (si el servidor lo permite).
  - Si el tamaño declarado supera `cap_bytes` -> estado `too_large` (sin descarga).
  - GET en streaming hasta `cap_bytes`; si se supera -> `truncated` (se conserva
    la muestra parcial, útil para CSV/TXT).
  - Los archivos se vuelcan a disco en un directorio temporal del run.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

import requests

USER_AGENT = "CyLDataQualityPortal/1.0 (data-analysis)"

TIMEOUT_CONNECT = 15
TIMEOUT_READ = 60

# Si tras SLOW_SECONDS la descarga no ha llegado a SLOW_MIN_BYTES, se aborta y se
# reintenta: los servidores que "gotean" bytes nunca disparan el timeout de
# lectura de requests (se mide por chunk) y secuestrarían el worker para siempre.
SLOW_SECONDS = 30
SLOW_MIN_BYTES = 300 * 1024


class SlowDownloadError(Exception):
    pass


def _suggest_extension(url: str) -> str:
    """Extensión sugerida a partir de la URL de descarga.

    Es importante conservar la extensión real (p. ej. .csv, .json): librerías
    como Frictionless y openpyxl infieren el formato a partir de la extensión
    del fichero, y un nombre genérico (.bin) rompe esa inferencia.
    """
    try:
        name = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
        ext = Path(name).suffix.lower() if name else ""
        if ext and len(ext) <= 8 and ext[1:].isalnum():
            return ext
    except Exception:
        pass
    return ".bin"


class FetchError(Exception):
    pass


class FetchResult:
    __slots__ = (
        "status", "path", "size", "http_status", "duration_ms",
        "truncated", "note", "final_url",
    )

    def __init__(self, status: str, path: Path | None = None, size: int = 0,
                 http_status: int | None = None, duration_ms: int = 0,
                 truncated: bool = False, note: str = "", final_url: str = ""):
        self.status = status          # downloaded | too_large | truncated | http_error | unreachable
        self.path = path
        self.size = size
        self.http_status = http_status
        self.duration_ms = duration_ms
        self.truncated = truncated
        self.note = note
        self.final_url = final_url


def fetch(url: str, dest_dir: Path, cap_bytes: int, timeout: int = TIMEOUT_READ,
          retries: int = 2, on_start=None) -> FetchResult:
    """Descarga `url` a `dest_dir` con límites. Devuelve FetchResult.

    `on_start` (opcional): callable(info: dict) invocado antes del GET, con
    {"url", "declared_bytes", "final_url"} para poder reportar cuándo inicia
    cada descarga y el peso declarado por el servidor.
    """
    start = time.monotonic()
    session = requests.Session()

    # 1) HEAD previo (opcional, no bloqueante si falla)
    content_length: int | None = None
    content_type = ""
    try:
        head = session.head(
            url, allow_redirects=True, timeout=(TIMEOUT_CONNECT, TIMEOUT_READ),
            headers={"User-Agent": USER_AGENT},
        )
        content_length = int(head.headers.get("Content-Length", 0) or 0) or None
        content_type = head.headers.get("Content-Type", "")
        final_url = head.url
    except Exception:
        final_url = url

    if on_start:
        try:
            on_start({"url": url, "declared_bytes": content_length,
                      "content_type": content_type, "final_url": final_url})
        except Exception:
            pass

    if content_length and content_length > cap_bytes:
        return FetchResult(
            status="too_large", size=content_length, http_status=200,
            duration_ms=int((time.monotonic() - start) * 1000),
            note=f"Tamaño declarado {content_length / 1e6:.1f} MB supera el tope de {cap_bytes / 1e6:.1f} MB",
            final_url=final_url,
        )

    # 2) GET en streaming con tope
    last_err: Exception | None = None
    tmp: Path | None = None
    for attempt in range(retries + 1):
        try:
            resp = session.get(
                url, stream=True, allow_redirects=True,
                timeout=(TIMEOUT_CONNECT, timeout),
                headers={"User-Agent": USER_AGENT},
            )
            if resp.status_code >= 400:
                resp.close()
                return FetchResult(
                    status="http_error", http_status=resp.status_code,
                    duration_ms=int((time.monotonic() - start) * 1000),
                    note=f"HTTP {resp.status_code}",
                    final_url=resp.url,
                )
            final_url = resp.url
            tmp = dest_dir / f"dl_{abs(hash(url)) % 10**9}{_suggest_extension(final_url or url)}"
            size = 0
            truncated = False
            _dl_start = time.monotonic()
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        size += len(chunk)
                        if size > cap_bytes:
                            truncated = True
                            break
                        fh.write(chunk)
                    if (time.monotonic() - _dl_start) > SLOW_SECONDS and size < SLOW_MIN_BYTES:
                        raise SlowDownloadError(
                            f"descarga demasiado lenta ({size / 1024:.0f} KB en {SLOW_SECONDS}s)")
            resp.close()
            if size == 0 and not truncated:
                # Respuesta 200 vacía: algunos servidores (datosabiertos.jcyl.es)
                # la devuelven de forma intermitente; reintentar como error transitorio.
                tmp.unlink(missing_ok=True)
                if attempt < retries:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                return FetchResult(
                    status="downloaded", size=0, http_status=resp.status_code,
                    duration_ms=int((time.monotonic() - start) * 1000),
                    note="El servidor respondió 200 vacío en todos los intentos (contenido no disponible)",
                    final_url=final_url,
                )
            return FetchResult(
                status="truncated" if truncated else "downloaded",
                path=tmp if size > 0 else None,
                size=size,
                http_status=resp.status_code,
                duration_ms=int((time.monotonic() - start) * 1000),
                truncated=truncated,
                note="Muestra truncada por tope de tamaño" if truncated else "",
                final_url=final_url,
            )
        except SlowDownloadError as exc:
            last_err = exc
            try:
                resp.close()
            except Exception:
                pass
            if tmp is not None:
                try:
                    tmp.unlink(missing_ok=True)
                except Exception:
                    pass
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
        except requests.RequestException as exc:
            last_err = exc
            try:
                resp.close()
            except Exception:
                pass
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
        except Exception as exc:
            # Blindaje total: nunca debe morir un worker por un error inesperado
            # (p.ej. UnicodeDecodeError de requests al resolver un redirect con
            # bytes latin-1). Se trata como error transitorio y se reintenta.
            last_err = exc
            try:
                resp.close()
            except Exception:
                pass
            if tmp is not None:
                try:
                    tmp.unlink(missing_ok=True)
                except Exception:
                    pass
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    return FetchResult(
        status="unreachable", duration_ms=int((time.monotonic() - start) * 1000),
        note=f"No se pudo descargar: {last_err and type(last_err).__name__}: {last_err}",
        final_url=final_url,
    )


def make_run_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="clyl-analysis-"))
