'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, Loader2, Braces, Sheet as SheetIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { JsonTree } from '@/components/quality/json-tree';
import { TableExplorer, type ExtraTab } from '@/components/quality/table-explorer';
import { parseTable } from '@/lib/csv-parse';
import { readXlsx, ZipError } from '@/lib/xlsx-read';
import { jsonRecordTable, describeJson } from '@/lib/json-to-table';
import { formatBytes } from '@/lib/quality-labels';
import type { UnitVoice } from '@/lib/unit-words';
import {
  CLIENT_TIMEOUT_MS,
  TABLE_AUTOLOAD_CAP,
  PROXY_MAX_BYTES,
  exceedsProxyLimit,
} from '@/lib/download-budget';

/** Formatos que el navegador sabe abrir y convertir a filas y columnas. */
export type FileKind = 'csv' | 'xlsx' | 'json';

type Status = 'loading' | 'loaded' | 'error' | 'too-big';
type Failure = 'http' | 'empty' | 'network' | 'parse' | 'formato' | 'no-cabe';

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
 * informe. Eso permite recorrer TODOS los casos de una incidencia —el informe
 * solo guarda cinco muestras— y da cifras de hoy aunque el análisis sea viejo
 * o se cortara por tamaño.
 */
export function FileExplorer({ url, kind, sizeBytes, reportedRows, reportTruncated }: FileExplorerProps) {
  const tooBig = sizeBytes != null && sizeBytes > TABLE_AUTOLOAD_CAP;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>(tooBig ? 'too-big' : 'loading');
  const [failure, setFailure] = useState<{ kind: Failure; detail?: string } | null>(null);
  const [source, setSource] = useState<Loaded | null>(null);
  const [sheet, setSheet] = useState(0);

  useEffect(() => {
    if (tooBig && attempt === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: controller.signal });
        if (cancelled) return;
        // 413 lo pone nuestro proxy al pasarse del techo, no el origen:
        // achacárselo al publicador era culparle de un límite nuestro.
        if (res.status === 413) { setFailure({ kind: 'no-cabe' }); setStatus('error'); return; }
        if (!res.ok) { setFailure({ kind: 'http', detail: `HTTP ${res.status}` }); setStatus('error'); return; }

        if (kind === 'xlsx') {
          const buffer = await res.arrayBuffer();
          if (cancelled) return;
          if (buffer.byteLength === 0) { setFailure({ kind: 'empty' }); setStatus('error'); return; }
          try {
            setSource({ sheets: await readXlsx(buffer) });
          } catch (err) {
            setFailure({
              kind: 'formato',
              detail: err instanceof ZipError ? err.message : 'El archivo no se pudo abrir como hoja de cálculo.',
            });
            setStatus('error');
            return;
          }
        } else {
          const body = await res.text();
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
      } catch {
        if (!cancelled) { setFailure({ kind: 'network' }); setStatus('error'); }
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [url, kind, attempt, tooBig]);

  /* ── Estados previos a los datos ── */

  if (status === 'too-big') {
    return (
      <Card tone="warn">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="text-sm leading-relaxed text-body">
            El archivo ocupa {formatBytes(sizeBytes)}; no se abre solo para no cargar tantos datos en el
            navegador sin avisar.
            {/*
              Pasado el techo del proxy, «abrirlo de todos modos» no puede
              cumplirse: el intento acabaría en un 413. Se dice el límite y se
              deja solo la descarga, en vez de invitar a algo que va a fallar.
            */}
            {exceedsProxyLimit(sizeBytes) && (
              <> Y pasa de {formatBytes(PROXY_MAX_BYTES)}, que es el máximo que este portal puede traer,
              así que aquí no se puede enseñar.</>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {!exceedsProxyLimit(sizeBytes) && (
                <button
                  type="button"
                  onClick={() => { setStatus('loading'); setAttempt((n) => n + 1); }}
                  className="font-medium text-link underline-offset-2 hover:underline"
                >
                  Abrirlo de todos modos
                </button>
              )}
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
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-fill p-4 text-sm text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Descargando y analizando el archivo completo…
      </div>
    );
  }

  if (status === 'error' || !source) {
    const message =
      failure?.kind === 'no-cabe' ? `El archivo pasa de ${formatBytes(PROXY_MAX_BYTES)}, que es lo máximo que este portal puede traer para enseñarlo aquí. El archivo puede estar perfectamente: no cabe en el visor.`
      : failure?.kind === 'empty' ? 'El archivo se descargó vacío.'
      : failure?.kind === 'http' ? `El servidor de origen devolvió un error (${failure.detail}) al pedir el archivo.`
      : failure?.kind === 'parse' ? 'El recurso se descargó pero su contenido no es JSON válido. La incidencia debería aparecer también en el análisis de esta distribución.'
      : failure?.kind === 'formato' ? failure.detail!
      : 'No se pudo contactar con el origen del archivo (sin respuesta o demasiado lento).';
    // No caber en el visor es un límite de este portal, no un defecto del
    // archivo: se avisa en ámbar, no en rojo, y no se ofrece reintentar porque
    // el segundo intento fallaría igual.
    const esLimiteNuestro = failure?.kind === 'no-cabe';
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
              {!esLimiteNuestro && (
                <button
                  type="button"
                  onClick={() => { setStatus('loading'); setFailure(null); setAttempt((n) => n + 1); }}
                  className="font-medium text-link underline-offset-2 hover:underline"
                >
                  Reintentar
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
