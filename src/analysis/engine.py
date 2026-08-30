"""Motor de análisis: coordina descarga + analizador por distribución."""
from __future__ import annotations

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .checks import PORTAL_LIMITATION_CODES, PUBLICATION_DEFECT_CODES
from .downloader import FetchResult, fetch, make_run_dir
from .formats import REGISTRY
from .occurrences import simple_issue

# Formatos que se analizan como servicio HTTP (no se descarga archivo)
SERVICE_FORMATS = {"WMS", "WFS"}

# Formatos que admiten muestra truncada (streaming con tope)
SAMPLEABLE_FORMATS = {"CSV", "TXT"}

_PRINT_LOCK = threading.Lock()
_VERBOSE = True  # lo activa run_analysis según `verbose`


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _url_basename(url: str, max_len: int = 90) -> str:
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1]) or url
    return name if len(name) <= max_len else name[: max_len - 3] + "..."


def vprint(line: str) -> None:
    """Línea de detalle por item, hilo seguro."""
    if not _VERBOSE:
        return
    with _PRINT_LOCK:
        print(line, flush=True)


def _size_str(size: int | None) -> str:
    if not size:
        return "peso desconocido"
    return f"{size / 1e6:.1f} MB" if size >= 1e6 else f"{size / 1e3:.0f} KB"


def _dataset_label(title: str, max_len: int = 60) -> str:
    """Título del dataset recortado para la línea de consola."""
    title = (title or "").strip()
    if not title:
        return "(sin titulo)"
    return title if len(title) <= max_len else title[: max_len - 3] + "..."


class ProgressReporter:
    """Informe de avance en consola con ETA (hilo seguro)."""

    def __init__(self, total: int, every: int = 25,
                 done0: int = 0, ok0: int = 0, failed0: int = 0,
                 skipped0: int = 0, bytes0: int = 0):
        self.total = total
        self.every = every
        self.done = done0
        self.ok = ok0
        self.failed = failed0
        self.skipped = skipped0
        self.bytes_downloaded = bytes0
        self.start = time.monotonic()
        self.ema = 1.0  # segundos por item (media móvil)
        self._lock = threading.Lock()

    def update(self, result: dict, duration_s: float, size: int) -> None:
        with self._lock:
            self.done += 1
            self.bytes_downloaded += size
            if result.get("status") == "ok":
                self.ok += 1
            elif result.get("status") == "skipped":
                self.skipped += 1
            else:
                self.failed += 1
            if duration_s > 0:
                self.ema = 0.8 * self.ema + 0.2 * duration_s
            if self.done % self.every == 0 or self.done == self.total:
                self._report_locked()

    def _report_locked(self) -> None:
        elapsed = time.monotonic() - self.start
        remaining = (self.total - self.done) * self.ema if self.done else 0
        pct = self.done / self.total * 100 if self.total else 100
        mb = self.bytes_downloaded / 1e6
        m, s = divmod(int(remaining), 60)
        h, m = divmod(m, 60)
        eta = f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"
        # `elapsed` puede ser 0: si el checkpoint ya trae todo el catálogo, no hay
        # nada que descargar y la ejecución entera cabe entre dos lecturas del
        # reloj. Sin esta guarda, `reporter.final()` lanzaba `ZeroDivisionError` y
        # tiraba el proceso DESPUÉS de haber hecho el trabajo pero ANTES de escribir
        # el informe: exactamente el caso de volver a agregar un análisis ya hecho.
        speed = f"{self.done / elapsed:.1f}" if elapsed > 0 else "—"
        print(
            f"[{self.done}/{self.total}] {pct:5.1f}% | ok={self.ok} err={self.failed} skip={self.skipped} "
            f"| {mb:6.1f} MB | vel={speed} it/s | ETA {eta}",
            flush=True,
        )

    def final(self) -> None:
        with self._lock:
            self._report_locked()


def _load_checkpoint(path: Path) -> dict[str, dict]:
    """Carga resultados previos (JSONL) indexados por URL de distribución."""
    done: dict[str, dict] = {}
    if not path.exists():
        return done
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                url = entry.get("url", "")
                if url and isinstance(entry.get("result"), dict):
                    done[url] = entry["result"]
            except Exception:
                continue
    return done


#: Fallos de escritura del checkpoint ya avisados, para no repetir el aviso 1.600 veces.
_checkpoint_failures = {"count": 0, "first_error": ""}


def _append_checkpoint(path: Path, url: str, result: dict) -> None:
    """
    Añade un resultado al checkpoint JSONL (append atómico por línea).

    Si la escritura falla, se AVISA. Antes era un `except Exception: pass`, y eso
    convirtió un fallo recuperable en pérdida de trabajo invisible: en la ejecución
    del 14 de agosto el fichero llegó a 132 MB dentro de una carpeta sincronizada con
    OneDrive y los `append` empezaron a devolver `OSError [Errno 22] Invalid
    argument`. El análisis siguió tres cuartos de hora tan campante, imprimiendo
    `ok` por cada archivo, y al cortarse el proceso se perdieron ~70 resultados que
    parecían guardados. El checkpoint existe precisamente para que un corte no
    cueste horas: si deja de funcionar, hay que decirlo en voz alta.

    Se sigue sin lanzar la excepción —un fallo al guardar el progreso no debe tumbar
    un análisis de horas— pero el aviso sale por stderr y el recuento va al resumen
    final, así que quien lo ejecuta sabe que no puede contar con reanudar.
    """
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"url": url, "result": result}, ensure_ascii=False) + "\n")
    except Exception as exc:
        _checkpoint_failures["count"] += 1
        if _checkpoint_failures["count"] == 1:
            _checkpoint_failures["first_error"] = f"{type(exc).__name__}: {exc}"
            print(
                f"\n  AVISO: no se puede escribir en el checkpoint ({type(exc).__name__}: {exc})."
                f"\n  {path}"
                "\n  El análisis continúa, pero SIN red de reanudación: si se corta, se pierde"
                "\n  todo lo analizado desde ahora. Con OneDrive o similar, usa --checkpoint"
                "\n  apuntando a una ruta local fuera de la carpeta sincronizada.\n",
                file=sys.stderr,
                flush=True,
            )


#: Por debajo de esto se mira el contenido antes de mandarlo al analizador.
#:
#: Un archivo de cero bytes ya se detectaba, pero el servidor del catálogo sirve
#: también archivos con SOLO un salto de línea: 2 bytes, un CRLF. Con la regla
#: anterior —«vacío» exigía cero exactos— esos dos bytes llegaban al analizador de
#: formato, que decía lo suyo: «el archivo no es un ZIP válido» para un .shp y
#: «XML no bien formado» para un .kml. Las dos frases son ciertas y las dos
#: mandan a quien las lee al sitio equivocado, a buscar un ZIP corrupto donde no
#: hay nada que corromper.
#:
#: 64 bytes es de sobra para distinguir «no hay nada» de «hay poco»: ningún
#: formato del catálogo cabe en menos.
EMPTY_SAMPLE_BYTES = 64


def _effectively_empty(path, size: int) -> bool:
    """¿Este archivo está vacío en todo lo que importa?"""
    if size == 0:
        return True
    if size > EMPTY_SAMPLE_BYTES or path is None:
        return False
    try:
        return path.read_bytes().strip() == b""
    except OSError:
        return False


def run_item(item: dict, ctx: dict) -> dict:
    """Analiza una distribución y devuelve su resultado normalizado."""
    start = time.monotonic()
    url = item.get("url", "")
    fmt = item.get("format", "OTRO")
    result: dict = {
        "dataset_index": item["dataset_index"],
        "dataset_id": item.get("dataset_id", ""),
        "dataset_title": item.get("dataset_title", ""),
        "format": fmt,
        "mime": item.get("mime", ""),
        "url": url,
        "status": "error",
        "fetch": None,
        "analysis": None,
        "duration_ms": 0,
    }

    if not url:
        result["status"] = "skipped"
        result["fetch"] = {"status": "no_url", "note": "La distribución no tiene URL de acceso"}
        result["duration_ms"] = int((time.monotonic() - start) * 1000)
        return result

    ctx = {
        **ctx,
        "declared_format": fmt,
        "service": fmt in SERVICE_FORMATS,
    }

    if fmt in SERVICE_FORMATS:
        # WMS/WFS: análisis vía HTTP (GetCapabilities), sin archivo
        try:
            from .formats.ogc import analyze_ogc

            vprint(f"[{_ts()}] → [{fmt}] {_url_basename(url)} · consultando GetCapabilities")
            analysis = analyze_ogc(url, ctx)
            result["fetch"] = {"status": "service", "size": 0, "http_status": None,
                               "note": "Servicio OGC analizado vía GetCapabilities"}
            result["status"] = "ok" if analysis["ok"] else "error"
            result["analysis"] = analysis
        except Exception as exc:
            result["status"] = "error"
            result["fetch"] = {"status": "error", "note": f"Fallo interno: {exc}"}
        result["duration_ms"] = int((time.monotonic() - start) * 1000)
        return result

    # Descarga con tope de tamaño (muestra menor para formatos muestreables)
    cap = ctx["sample_cap"] if fmt in SAMPLEABLE_FORMATS else ctx["size_cap"]

    def _on_dl_start(info: dict) -> None:
        # Muestra el progreso (N/total) y el dataset, no el peso declarado:
        # el HEAD de datosabiertos.jcyl.es devuelve la pagina del portal (html)
        # en vez del archivo, asi que ese peso casi nunca es fiable.
        idx = ctx.get("item_index", "?")
        total = ctx.get("total", "?")
        vprint(f"[{_ts()}] > [{fmt}] ({idx}/{total}) {_dataset_label(item.get('dataset_title', ''))} | {_url_basename(url)} | inicia descarga")

    fetch_res: FetchResult = fetch(url, ctx["run_dir"], cap,
                                   timeout=ctx["timeout"], retries=ctx["retries"],
                                   on_start=_on_dl_start)
    result["fetch"] = {
        "status": fetch_res.status,
        "size": fetch_res.size,
        "http_status": fetch_res.http_status,
        "duration_ms": fetch_res.duration_ms,
        "truncated": fetch_res.truncated,
        "note": fetch_res.note,
        "final_url": fetch_res.final_url,
    }

    if fetch_res.status == "too_large":
        result["status"] = "skipped"
        result["analysis"] = {
            "ok": False, "score": None, "summary": fetch_res.note,
            "metrics": {"size_bytes": fetch_res.size}, "issues": [],
        }
        result["duration_ms"] = int((time.monotonic() - start) * 1000)
        return result

    if fetch_res.status in ("http_error", "unreachable"):
        result["status"] = "error"
        result["analysis"] = {
            "ok": False, "score": None, "summary": fetch_res.note,
            "metrics": {}, "issues": [{"code": "descarga", "label": fetch_res.note,
                                       "severity": "error", "count": 1}],
        }
        result["duration_ms"] = int((time.monotonic() - start) * 1000)
        return result

    if fetch_res.path is None or _effectively_empty(fetch_res.path, fetch_res.size):
        cuantos = f"{fetch_res.size} bytes" if fetch_res.size else "0 bytes"
        detalle = " (solo espacios o saltos de línea)" if fetch_res.size else ""
        result["status"] = "error"
        result["analysis"] = {
            "ok": False, "score": None, "summary": f"Archivo vacío ({cuantos}){detalle}",
            "metrics": {}, "issues": [{"code": "archivo-vacio",
                                       "label": f"El archivo descargado está vacío ({cuantos})",
                                       "severity": "error", "count": 1}],
        }
        result["duration_ms"] = int((time.monotonic() - start) * 1000)
        return result

    # Ejecutar analizador del formato
    analyzer = REGISTRY.get(fmt)
    if analyzer is None:
        from .formats.binary import analyze_binary

        analyzer = analyze_binary

    file_ctx = {
        **ctx,
        "truncated": fetch_res.truncated,
        "size_bytes": fetch_res.size,
    }
    try:
        analysis = analyzer(fetch_res.path, file_ctx)
        result["analysis"] = analysis
        # Fallos técnicos nuestros (dependencia no instalada, contenido que no es
        # el formato declarado por la plataforma, etc.) NO son fallos del dataset:
        # se marcan como "skipped" para no penalizar al proveedor ni al score.
        if not analysis.get("ok"):
            codes = {i.get("code") for i in analysis.get("issues", [])}
            # Dos conceptos distintos, cada uno con su nombre (ver `checks.py`):
            # lo que no pudimos comprobar nosotros y lo que la plataforma de
            # publicación no entrega. Ninguno es un defecto de los datos del
            # organismo, así que ninguno se cuenta como error.
            if codes & (PORTAL_LIMITATION_CODES | PUBLICATION_DEFECT_CODES):
                result["status"] = "skipped"
            else:
                result["status"] = "error"
        else:
            result["status"] = "ok"
    except Exception as exc:
        # «skipped» y no «error»: que se rompa nuestro analizador no dice nada del
        # archivo, que puede estar perfectamente. Antes esto quedaba como error del
        # dataset y penalizaba al publicador por un fallo nuestro.
        result["status"] = "skipped"
        result["analysis"] = {
            "ok": False, "score": None,
            "summary": f"Fallo interno del analizador {fmt}: {type(exc).__name__}: {exc}",
            # La etiqueta es una frase, no `str(exc)`: es lo que se lee en la tabla
            # de archivos del portal, y ahí un `KeyError: 'geometry'` no significa
            # nada para quien publica o reutiliza el dato. El detalle técnico sigue
            # entero en `summary`, que es donde se va a buscar.
            #
            # Vía `simple_issue` porque este dict no pasa por `_normalize`, así que
            # `finalize_issues` no le añade el `stored` que la interfaz espera en
            # TODA incidencia: escrito a mano se quedaba sin él.
            "metrics": {}, "issues": [
                simple_issue("fallo-analizador", "Fallo interno del análisis de este portal", "info")
            ],
        }
    finally:
        try:
            fetch_res.path.unlink(missing_ok=True)
        except Exception:
            pass

    result["duration_ms"] = int((time.monotonic() - start) * 1000)
    return result


def _print_item_done(result: dict, item_index: int | None = None, total: int | None = None) -> None:
    """Línea de detalle al terminar cada item (dataset, progreso, peso real, resultado)."""
    name = _url_basename(result.get("url", ""), max_len=40)
    fmt = result.get("format", "?")
    size = (result.get("fetch") or {}).get("size", 0)
    dur = result["duration_ms"] / 1000
    st = result.get("status")
    analysis = result.get("analysis") or {}
    score = analysis.get("score")
    if st == "ok":
        mark = "ok "
        info = f"score {score}" if score is not None else "ok"
    elif st == "skipped":
        mark = "skp"
        info = "omitido"
    else:
        mark = "err"
        note = analysis.get("summary") or (result.get("fetch") or {}).get("note") or st
        info = str(note)[:80]
    where = f"({item_index + 1}/{total}) " if item_index is not None and total else ""
    ds = _dataset_label(result.get("dataset_title", ""))
    vprint(f"[{_ts()}] {mark} [{fmt}] {where}{ds} | {name} | {_size_str(size)} | {info} ({dur:.1f}s)")


def run_analysis(items: list[dict], workers: int, size_cap: int, sample_cap: int | None = None,
                 timeout: int = 60, retries: int = 2, progress_every: int = 25,
                 checkpoint: Path | None = None, verbose: bool = True,
                 force_urls: set[str] | None = None) -> list[dict]:
    """Analiza `items`. Si `checkpoint` (JSONL) existe, reanuda saltando lo ya hecho.

    Los resultados se indexan por URL de distribución, por lo que reanudar es
    seguro incluso si el catálogo de entrada cambia de orden.

    `force_urls` (opcional) marca URLs que DEBEN re-analizarse aunque ya estén
    en el checkpoint: son las de los datasets nuevos o modificados que detecta
    `incremental.plan_incremental`. Sin él, el checkpoint reutiliza por URL a
    ciegas y un dataset que cambió de plantilla no se vuelve a analizar.
    """
    global _VERBOSE
    _VERBOSE = verbose
    fuercé = force_urls or set()
    run_dir = make_run_dir()
    ctx = {"run_dir": run_dir, "size_cap": size_cap, "sample_cap": sample_cap or size_cap,
           "timeout": timeout, "retries": retries}
    results: list[dict | None] = [None] * len(items)

    # Reanudación: volcar resultados previos en su posición (salvo los forzados)
    done_by_url: dict[str, dict] = {}
    if checkpoint is not None:
        done_by_url = _load_checkpoint(checkpoint)
        for idx, item in enumerate(items):
            url = item.get("url", "")
            if url in fuercé:
                continue  # se reanaliza: no se reutiliza el resultado viejo
            prev = done_by_url.get(url)
            if prev is not None:
                results[idx] = prev

    done0 = sum(1 for r in results if r is not None)
    ok0 = sum(1 for r in results if r is not None and r.get("status") == "ok")
    failed0 = sum(1 for r in results if r is not None and r.get("status") == "error")
    skipped0 = sum(1 for r in results if r is not None and r.get("status") == "skipped")
    bytes0 = sum((r.get("fetch") or {}).get("size", 0) for r in results if r is not None)

    reporter = ProgressReporter(total=len(items), every=progress_every,
                                done0=done0, ok0=ok0, failed0=failed0,
                                skipped0=skipped0, bytes0=bytes0)
    pending = [idx for idx, r in enumerate(results) if r is None]

    def _run(idx: int, item: dict) -> tuple[int, dict]:
        # Blindaje total: un worker jamás debe morir (ni tumbar el run completo).
        # Si run_item lanza algo inesperado, se registra como error analizable.
        item_ctx = {**ctx, "item_index": idx, "total": len(items)}
        try:
            return idx, run_item(item, item_ctx)
        except Exception as exc:
            result: dict = {
                "dataset_index": item.get("dataset_index"),
                "dataset_id": item.get("dataset_id", ""),
                "dataset_title": item.get("dataset_title", ""),
                "format": item.get("format", "OTRO"),
                "mime": item.get("mime", ""),
                "url": item.get("url", ""),
                "status": "error",
                "fetch": {"status": "error", "note": f"Fallo interno del engine: {type(exc).__name__}: {exc}"},
                "analysis": None,
                "duration_ms": 0,
            }
            return idx, result

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_run, idx, items[idx]) for idx in pending]
        for fut in as_completed(futures):
            idx, result = fut.result()
            results[idx] = result
            if checkpoint is not None:
                _append_checkpoint(checkpoint, items[idx].get("url", ""), result)
            _print_item_done(result, idx, len(items))
            reporter.update(result, result["duration_ms"] / 1000, (result["fetch"] or {}).get("size", 0))

    reporter.final()

    # El aviso, otra vez y al final: entre miles de líneas de avance, uno a mitad
    # de la ejecución se pierde de vista, y lo que está en juego es saber si se
    # puede reanudar o no.
    if _checkpoint_failures["count"] > 0:
        print(
            f"\n  AVISO: {_checkpoint_failures['count']} resultados NO se pudieron guardar en el"
            f"\n  checkpoint ({_checkpoint_failures['first_error']}). El informe de esta ejecución"
            "\n  sí está completo, pero si vuelves a lanzar el análisis esos archivos se"
            "\n  descargarán otra vez. Usa --checkpoint en una ruta local fuera de OneDrive.",
            file=sys.stderr,
            flush=True,
        )

    return results
