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
from urllib.parse import quote, unquote, urljoin, urlsplit

import requests

#: Saltos máximos al seguir redirecciones a mano. El mismo tope que usa requests.
MAX_REDIRECTS = 30

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


def _redirect_target(response: requests.Response) -> str | None:
    """
    La URL de un `Location`, aunque venga con bytes crudos sin escapar.

    `requests` hace `location.encode('latin1').decode('utf8')` en
    `get_redirect_target`, así que un `Location` con un byte no-UTF8 suelto lo
    revienta con `UnicodeDecodeError` antes de llegar a descargar nada.

    No es hipotético: diez CSV del catálogo redirigen a
    `transparencia.jcyl.es/educacion/JCYLEducación_Estudios_2022.csv` con la `ó`
    en un solo byte `0xf3` en vez de percent-encoded. Los diez se archivaban como
    «No se pudo descargar», que en el portal se lee como un fallo del organismo,
    cuando el archivo se descarga perfectamente: son 817 KB que llegan con
    HTTP 200. Es justo lo que la metodología promete NO imputar a quien publica.

    Aquí se recuperan los bytes originales (el módulo `http` decodifica las
    cabeceras como latin-1, así que el viaje de ida y vuelta es exacto) y se
    escapan los no-ASCII, que es lo que el servidor debería haber enviado.
    """
    location = response.headers.get("location")
    if not location:
        return None
    raw = location.encode("latin-1", errors="replace")
    try:
        target = raw.decode("utf-8")
    except UnicodeDecodeError:
        # `safe` conserva la puntuación de una URL —incluido `%`, para no volver
        # a escapar lo que ya venía escapado— y deja fuera solo los bytes altos.
        #
        # Se escapa el byte tal cual (`%F3`) y no su equivalente en UTF-8
        # (`%C3%B3`): sin saber el juego de caracteres del servidor, respetar los
        # bytes que envió es lo fiel. Comprobado contra el origen: acepta las dos
        # formas y devuelve el archivo con cualquiera de ellas.
        target = quote(raw, safe="/:?#[]@!$&'()*+,;=%~")
    # Un `Location` relativo es legal y hay que resolverlo contra la petición.
    return urljoin(response.url, target)


def _get_streaming(session: requests.Session, url: str, timeout: int) -> requests.Response:
    """
    GET en streaming siguiendo redirecciones, tolerante a `Location` mal escapado.

    Primero se intenta por la vía normal de `requests`, que es la probada y la
    que siguen las 1.652 distribuciones que no dan problema. El seguimiento a
    mano es solo el plan B cuando esa vía se ahoga decodificando la cabecera, así
    que no puede alterar lo que hoy ya funciona.
    """
    common = {
        "stream": True,
        "timeout": (TIMEOUT_CONNECT, timeout),
        "headers": {"User-Agent": USER_AGENT},
    }
    try:
        return session.get(url, allow_redirects=True, **common)
    except UnicodeDecodeError:
        pass

    current = url
    for _ in range(MAX_REDIRECTS):
        response = session.get(current, allow_redirects=False, **common)
        if not response.is_redirect:
            return response
        target = _redirect_target(response)
        response.close()
        if not target:
            return response
        current = target
    raise FetchError(f"Más de {MAX_REDIRECTS} redirecciones desde {url}")


#: Los OCHO valores que puede tomar `fetch.status`, y quién los pone.
#:
#: Aquí:        downloaded, truncated, too_large, http_error, unreachable
#: `engine.py`: service (WMS/WFS, no hay archivo), no_url, error (fallo interno)
#:
#: La lista estaba en un comentario al lado de la asignación y solo nombraba cinco.
#: Los tres que faltaban acabaron llegando a la interfaz sin traducción, porque
#: `ISSUE_LABELS` se escribió a partir de ese comentario. La unión de TypeScript que
#: tiene que decir lo mismo es `FetchStatus`, en `src/lib/quality-report.ts`.
FETCH_STATUSES = (
    "downloaded", "truncated", "too_large", "http_error", "unreachable",
    "service", "no_url", "error",
)


class FetchResult:
    __slots__ = (
        "status", "path", "size", "http_status", "duration_ms",
        "truncated", "note", "final_url",
    )

    def __init__(self, status: str, path: Path | None = None, size: int = 0,
                 http_status: int | None = None, duration_ms: int = 0,
                 truncated: bool = False, note: str = "", final_url: str = ""):
        self.status = status          # uno de FETCH_STATUSES
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
            resp = _get_streaming(session, url, timeout)
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
    # Un fallo de decodificación es NUESTRO, no del origen: el servidor contestó,
    # y quien no supo leer su respuesta fue este analizador. `unreachable` se lee
    # en el portal como «no se puede descargar», que señala al organismo por un
    # problema de casa. `error` significa exactamente «el análisis se interrumpió,
    # es un problema nuestro» —así está documentado en `/api`— y `classifyDelivery`
    # lo deja fuera del recuento en vez de contarlo como archivo roto.
    if isinstance(last_err, UnicodeDecodeError):
        return FetchResult(
            status="error", duration_ms=int((time.monotonic() - start) * 1000),
            note=f"El analizador no pudo leer la respuesta del servidor: {last_err}",
            final_url=final_url,
        )
    return FetchResult(
        status="unreachable", duration_ms=int((time.monotonic() - start) * 1000),
        note=f"No se pudo descargar: {last_err and type(last_err).__name__}: {last_err}",
        final_url=final_url,
    )


def make_run_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="clyl-analysis-"))
