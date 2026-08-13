'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Braces, Sheet as SheetIcon, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { JsonTree } from '@/components/quality/json-tree';
import { TableExplorer, type ExtraTab } from '@/components/quality/table-explorer';
import { parseTable } from '@/lib/csv-parse';
import { readXlsx, ZipError } from '@/lib/xlsx-read';
import { jsonRecordTable, describeJson } from '@/lib/json-to-table';
import { formatBytes } from '@/lib/quality-labels';
import type { UnitVoice } from '@/lib/unit-words';
import { TABLE_AUTOLOAD_CAP, rangeChunkCount, needsRangeDownload } from '@/lib/download-budget';
import { DownloadError, downloadResource, downloadText, probeResource, type Progress } from '@/lib/progressive-fetch';

/** Formatos que el navegador sabe abrir y convertir a filas y columnas. */
export type FileKind = 'csv' | 'xlsx' | 'json';

type Status = 'loading' | 'loaded' | 'error' | 'too-big';
type Failure = 'http' | 'empty' | 'network' | 'timeout' | 'parse' | 'formato' | 'no-cabe' | 'cancelado';

interface Sheet {
  name: string;
  header: string[];
  rows: string[][];
}

interface Loaded {
  sheets: Sheet[];
  /** Documento completo, solo para JSON: alimenta la pestaña de estructura. */
  json?: unknown;
  /** Resumen de la forma del documento JSON. */
  shape?: string;
  /** Ruta donde estaban los registros, si no eran el documento entero. */
  recordsPath?: string;
  detail?: string;
}

/** Un JSON es una lista de registros con campos; un CSV, filas con columnas. */
const VOICE: Record<FileKind, UnitVoice> = { csv: 'table', xlsx: 'table', json: 'record' };

interface FileExplorerProps {
  url: string;
  kind: FileKind;
  sizeBytes?: number | null;
  /** Filas que registró el analizador, para contrastar con el fichero de hoy. */
  reportedRows?: number | null;
  /** El analizador cortó la descarga: sus cifras cubren solo una parte. */
  reportTruncated?: boolean;
}

/**
 * Explorador del archivo: datos, columnas e incidencias en un mismo sitio,
 * porque son tres vistas de lo mismo.
 *
 * Sirve igual para CSV, XLSX y JSON. Cada formato solo aporta cómo se lee el
 * fichero; a partir de ahí todos se reducen a un encabezado y unas filas que
 * pinta `TableExplorer`. Lo propio de cada uno se conserva: el XLSX trae
 * selector de hoja y el JSON, su árbol.
 *
 * Todo se calcula sobre el fichero completo descargado aquí, no sobre el
 * informe: son las cifras de HOY, y el informe es una foto fechada. Cuando no
 * cuadran, se dice al pie con el motivo. Las incidencias que se cuentan arriba,
 * en la ficha, salen del informe: son la misma cifra en todas las pantallas.
 *
 * Los archivos grandes ya no se rechazan. `downloadResource` los trae por
 * tramos, con barra de progreso y botón de parar; antes, por encima del techo
 * del proxy el visor enseñaba el enlace al origen y se rendía.
 */
export function FileExplorer({ url, kind, sizeBytes, reportedRows, reportTruncated }: FileExplorerProps) {
  const tooBig = sizeBytes != null && sizeBytes > TABLE_AUTOLOAD_CAP;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>(tooBig ? 'too-big' : 'loading');
  const [failure, setFailure] = useState<{ kind: Failure; detail?: string } | null>(null);
  const [source, setSource] = useState<Loaded | null>(null);
  const [sheet, setSheet] = useState(0);
  /**
   * Progreso de la descarga en curso, etiquetado con el intento al que
   * pertenece. Va con clave y no suelto para no tener que ponerlo a cero al
   * arrancar el efecto: al cambiar de archivo o reintentar, el progreso viejo
   * deja de coincidir y se ignora solo.
   */
  const [progressState, setProgress] = useState<{ key: string; value: Progress } | null>(null);
  const loadKey = `${url}|${attempt}`;
  const progress = progressState?.key === loadKey ? progressState.value : null;
  /** Tamaño medido con `HEAD`, cuando el origen da uno de fiar (ver `probeResource`). */
  const [actualSize, setActualSize] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (tooBig && attempt === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    const onProgress = (value: Progress) => setProgress({ key: loadKey, value });

    (async () => {
      try {
        // El tamaño del catálogo falta en muchas distribuciones, y con él a
        // `null` el aviso de «pesa mucho» se saltaba entero. El `HEAD` lo
        // completa cuando el origen da un tamaño creíble, y dice si admite
        // tramos; si no, se sigue con el del informe.
        const probe = await probeResource(url, controller.signal);
        if (cancelled) return;
        if (probe.size != null) setActualSize(probe.size);
        const knownSize = probe.size ?? sizeBytes ?? null;

        if (kind === 'xlsx') {
          const bytes = await downloadResource(url, {
            signal: controller.signal,
            knownSize,
            onProgress,
          });
          if (cancelled) return;
          if (bytes.byteLength === 0) { setFailure({ kind: 'empty' }); setStatus('error'); return; }
          try {
            // `slice()` para entregar un ArrayBuffer propio: el `Uint8Array`
            // puede ser una vista sobre un buffer mayor.
            setSource({ sheets: await readXlsx(bytes.slice().buffer) });
          } catch (err) {
            setFailure({
              kind: 'formato',
              detail: err instanceof ZipError ? err.message : 'El archivo no se pudo abrir como hoja de cálculo.',
            });
            setStatus('error');
            return;
          }
        } else {
          const body = await downloadText(url, {
            signal: controller.signal,
            knownSize,
            onProgress,
          });
          if (cancelled) return;
          if (!body.trim()) { setFailure({ kind: 'empty' }); setStatus('error'); return; }

          if (kind === 'json') {
            let parsed: unknown;
            try {
              parsed = JSON.parse(body);
            } catch {
              setFailure({ kind: 'parse' });
              setStatus('error');
              return;
            }
            const table = jsonRecordTable(parsed);
            setSource({
              json: parsed,
              shape: describeJson(parsed),
              sheets: table ? [{ name: '', header: table.header, rows: table.rows }] : [],
              recordsPath: table?.path || undefined,
              detail: table && table.irregular > 0
                ? `${table.irregular.toLocaleString('es-ES')} registros no traen todas las claves del primero.`
                : undefined,
            });
          } else {
            const table = parseTable(body);
            setSource({ sheets: [{ name: '', header: table.header, rows: table.rows }] });
          }
        }
        if (!cancelled) setStatus('loaded');
      } catch (err) {
        if (cancelled) return;
        // El motivo viene clasificado desde `progressive-fetch`, así que el
        // mensaje ya no tiene que adivinar entre «lento» y «no existe».
        const reason = err instanceof DownloadError ? err.reason : 'network';
        setFailure({
          kind:
            reason === 'demasiado-grande' ? 'no-cabe'
            : reason === 'timeout' ? 'timeout'
            : reason === 'cancelado' ? 'cancelado'
            : reason === 'http' ? 'http'
            : 'network',
          detail: err instanceof DownloadError ? err.message : undefined,
        });
        setStatus('error');
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [url, kind, attempt, tooBig, sizeBytes, loadKey]);

  /* ── Estados previos a los datos ── */

  if (status === 'too-big') {
    // Ya no hay «esto no se puede enseñar»: con descarga por tramos cualquier
    // tamaño se puede traer. Lo que queda es una decisión informada, con el
    // coste por delante.
    const chunks = sizeBytes != null ? rangeChunkCount(sizeBytes) : 1;
    return (
      <Card tone="warn">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="text-sm leading-relaxed text-body">
            El archivo ocupa {formatBytes(sizeBytes)}; no se abre solo para no cargar tantos datos en el
            navegador sin avisar.
            {needsRangeDownload(sizeBytes) && (
              <> Se traerá en {chunks.toLocaleString('es-ES')} tramos, así que tardará un poco y podrás
              detenerlo cuando quieras.</>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => { setStatus('loading'); setAttempt((n) => n + 1); }}
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                Abrirlo de todos modos
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden /> Descargar el archivo
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === 'loading') {
    const total = progress?.total ?? actualSize ?? sizeBytes ?? null;
    const pct = progress && total ? Math.min(100, Math.round((progress.loaded / total) * 100)) : null;
    return (
      <div className="rounded-xl border border-border bg-fill p-4">
        <div className="flex items-center gap-2 text-sm text-faint">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="flex-1">
            Descargando el archivo
            {progress ? ` · ${formatBytes(progress.loaded)}${total ? ` de ${formatBytes(total)}` : ''}` : '…'}
          </span>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              setFailure({ kind: 'cancelado' });
              setStatus('error');
            }}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-link underline-offset-2 hover:underline"
          >
            <X className="h-3 w-3" aria-hidden /> Detener
          </button>
        </div>
        {/* Barra real, no un indicador indeterminado: en un archivo de 300 MB
            la diferencia entre «va por el 4%» y «sigue girando» es la que
            decide si alguien espera o se marcha. */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card" aria-hidden>
          <div
            className={`h-full rounded-full bg-link transition-[width] duration-200 ${pct == null ? 'animate-pulse' : ''}`}
            style={{ width: pct == null ? '25%' : `${Math.max(pct, 2)}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === 'error' || !source) {
    const message =
      failure?.kind === 'cancelado' ? 'Descarga detenida.'
      : failure?.kind === 'no-cabe' ? `${failure.detail ?? 'El archivo no se pudo traer entero.'} Se puede descargar desde el origen y abrirlo en local.`
      : failure?.kind === 'timeout' ? 'El origen tardó demasiado en responder. Puede estar saturado; reintentar suele funcionar.'
      : failure?.kind === 'empty' ? 'El archivo se descargó vacío.'
      : failure?.kind === 'http' ? `El servidor de origen devolvió un error (${failure.detail}) al pedir el archivo.`
      : failure?.kind === 'parse' ? 'El recurso se descargó pero su contenido no es JSON válido. La incidencia debería aparecer también en el análisis de esta distribución.'
      : failure?.kind === 'formato' ? failure.detail!
      : 'No se pudo contactar con el origen del archivo.';
    // Detenerlo a mano o toparse con un límite nuestro no son defectos del
    // archivo: se avisan en ámbar, no en rojo.
    const esLimiteNuestro = failure?.kind === 'no-cabe' || failure?.kind === 'cancelado';
    return (
      <Card tone={esLimiteNuestro ? 'warn' : 'bad'}>
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle
            className={`mt-0.5 h-4 w-4 shrink-0 ${esLimiteNuestro ? 'text-warn' : 'text-bad'}`}
            aria-hidden
          />
          <div className="text-sm leading-relaxed text-body">
            {message}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {failure?.kind !== 'no-cabe' && (
                <button
                  type="button"
                  onClick={() => { setStatus('loading'); setFailure(null); setAttempt((n) => n + 1); }}
                  className="font-medium text-link underline-offset-2 hover:underline"
                >
                  {failure?.kind === 'cancelado' ? 'Volver a intentarlo' : 'Reintentar'}
                </button>
              )}
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden /> Abrir el archivo
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const voice = VOICE[kind];
  const words = voice === 'record' ? 'registros' : 'filas';
  const sheets = source.sheets;
  const safeSheet = Math.min(sheet, Math.max(0, sheets.length - 1));
  const table = sheets[safeSheet];

  const extraTabs: ExtraTab[] = source.json !== undefined
    ? [{ id: 'estructura', label: 'Estructura', icon: Braces, content: <JsonTree data={source.json} url={url} /> }]
    : [];

  // Un JSON que no es una lista de registros no tiene tabla que enseñar: solo
  // queda su árbol, y decirlo es más honesto que fingir una tabla vacía.
  if (!table) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-border bg-fill px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-strong">
            <Braces className="h-3.5 w-3.5 text-faint" aria-hidden /> Estructura
          </span>
          <span className="text-[11px] text-faint">
            {source.shape}{sizeBytes ? ` · ${formatBytes(sizeBytes)}` : ''}
          </span>
        </div>
        <p className="border-b border-border px-3 py-2 text-[11px] leading-relaxed text-faint">
          Este JSON no es una lista de registros, así que no se puede recorrer como tabla: se muestra su
          árbol completo.
        </p>
        <JsonTree data={source.json} url={url} />
      </div>
    );
  }

  const rowsDiffer = reportedRows != null && Math.abs(reportedRows - table.rows.length) > 1;

  return (
    <TableExplorer
      header={table.header}
      rows={table.rows}
      voice={voice}
      downloadUrl={url}
      extraTabs={extraTabs}
      controls={
        sheets.length > 1 ? (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            <SheetIcon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Hoja</span>
            <select
              value={safeSheet}
              onChange={(e) => setSheet(Number(e.target.value))}
              className="h-7 max-w-[12rem] rounded-lg border border-field bg-card px-2 text-xs text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {sheets.map((s, i) => (
                <option key={i} value={i}>
                  {s.name || `Hoja ${i + 1}`} ({s.rows.length.toLocaleString('es-ES')})
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
      summary={
        <>
          {table.rows.length.toLocaleString('es-ES')} {words} · archivo completo
          {sizeBytes ? ` · ${formatBytes(sizeBytes)}` : ''}
          {source.recordsPath ? <> · registros de <code className="font-mono">{source.recordsPath}</code></> : null}
        </>
      }
      footnote={
        <>
          {source.detail && <p className="text-[11px] leading-relaxed text-faint">{source.detail}</p>}
          {/* Contraste con el informe: si no cuadran, casi siempre es porque el
              análisis se truncó o el fichero ha cambiado desde entonces. */}
          {rowsDiffer && (
            <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-faint">
              El análisis registró {reportedRows!.toLocaleString('es-ES')} {words} y aquí se leen{' '}
              {table.rows.length.toLocaleString('es-ES')}.{' '}
              {reportTruncated
                ? 'El analizador cortó la descarga por tamaño, así que sus cifras cubren solo esa parte; las de arriba son del archivo completo.'
                : 'El archivo puede haber cambiado desde el último análisis.'}
            </p>
          )}
        </>
      }
    />
  );
}
