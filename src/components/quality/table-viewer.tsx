'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Loader2, Search, X, Table2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { parseTable } from '@/lib/csv-parse';
import { formatBytes } from '@/lib/quality-labels';
import { cn } from '@/lib/utils';

const FETCH_TIMEOUT_MS = 30_000;
/** Por encima de esto no se descarga sola: son megas en el navegador. */
const AUTOLOAD_CAP = 8 * 1024 * 1024;
const ROWS_PER_PAGE = 50;

type Status = 'loading' | 'loaded' | 'error' | 'too-big';
type Failure = 'http' | 'empty' | 'network';

interface TableViewerProps {
  url: string;
  sizeBytes?: number | null;
  /** Filas que declaró el analizador, para contrastar con lo que se lee aquí. */
  reportedRows?: number | null;
  /** El analizador cortó la descarga por tamaño: sus cifras son parciales. */
  reportTruncated?: boolean;
}

/**
 * Vista previa del fichero tabular COMPLETO.
 *
 * El informe solo guarda las 10 primeras filas, que servían de muestra pero no
 * dejaban explorar el dato. Aquí se descarga el CSV real a través del proxy y
 * se pagina en el navegador, así que lo que se ve es el fichero entero.
 */
export function TableViewer({ url, sizeBytes, reportedRows, reportTruncated }: TableViewerProps) {
  const tooBig = sizeBytes != null && sizeBytes > AUTOLOAD_CAP;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>(tooBig ? 'too-big' : 'loading');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (tooBig && attempt === 0) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) { setFailure('http'); setStatus('error'); return; }
        const body = await res.text();
        if (cancelled) return;
        if (!body.trim()) { setFailure('empty'); setStatus('error'); return; }
        setText(body);
        setStatus('loaded');
      } catch {
        if (!cancelled) { setFailure('network'); setStatus('error'); }
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [url, attempt, tooBig]);

  const table = useMemo(() => (status === 'loaded' ? parseTable(text) : null), [status, text]);

  const filtered = useMemo(() => {
    if (!table) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return table.rows;
    return table.rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(needle)));
  }, [table, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE + ROWS_PER_PAGE);

  if (status === 'too-big') {
    return (
      <Card tone="warn">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="text-sm leading-relaxed text-body">
            El archivo ocupa {formatBytes(sizeBytes)}; no se abre solo para no cargar tantos datos en
            el navegador sin avisar.
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
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
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-fill p-4 text-sm text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Descargando el archivo completo…
      </div>
    );
  }

  if (status === 'error' || !table) {
    const message =
      failure === 'empty'
        ? 'El archivo se descargó vacío.'
        : failure === 'http'
        ? 'El servidor de origen devolvió un error al pedir el archivo.'
        : 'No se pudo contactar con el origen del archivo (sin respuesta o demasiado lento).';
    return (
      <Card tone="bad">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />
          <div className="text-sm leading-relaxed text-body">
            {message}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => { setStatus('loading'); setFailure(null); setAttempt((n) => n + 1); }}
                className="font-medium text-link underline-offset-2 hover:underline"
              >
                Reintentar
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-link underline-offset-2 hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden /> Abrir el archivo
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const mismatch = reportedRows != null && Math.abs(reportedRows - table.rows.length) > 1;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-fill px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-strong">
            <Table2 className="h-3.5 w-3.5 text-faint" aria-hidden />
            {table.rows.length.toLocaleString('es-ES')} filas × {table.header.length} columnas
          </span>
          <span className="text-[11px] text-faint">
            archivo completo{sizeBytes ? ` · ${formatBytes(sizeBytes)}` : ''} · delimitador{' '}
            <code className="font-mono">{table.delimiter === '\t' ? '\\t' : table.delimiter}</code>
          </span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-faint transition-colors hover:bg-card hover:text-body"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Descargar
        </a>
      </div>

      {/* Buscador */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Buscar en todas las filas…"
            aria-label="Buscar dentro del archivo"
            className="h-8 w-full rounded-lg border border-field bg-card pl-8 pr-7 text-xs text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setPage(0); }}
              aria-label="Limpiar búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-body"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        {query && (
          <span className="text-[11px] text-faint" role="status">
            {filtered.length.toLocaleString('es-ES')} de {table.rows.length.toLocaleString('es-ES')} filas
          </span>
        )}
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-xs">
          <thead>
            <tr className="border-b border-border bg-fill text-left">
              <th scope="col" className="w-14 px-2.5 py-2 font-semibold text-faint">#</th>
              {table.header.map((name, i) => (
                <th key={i} scope="col" className="max-w-[18rem] truncate px-2.5 py-2 font-semibold text-body" title={name}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => {
              const absolute = safePage * ROWS_PER_PAGE + ri;
              return (
                <tr key={absolute} className="border-b border-border last:border-0 hover:bg-fill">
                  <td className="px-2.5 py-1.5 tabular-nums text-faint">
                    {(absolute + 1).toLocaleString('es-ES')}
                  </td>
                  {table.header.map((_, ci) => {
                    const value = row[ci];
                    const empty = value == null || value.trim() === '';
                    return (
                      <td
                        key={ci}
                        className={cn('max-w-[18rem] truncate px-2.5 py-1.5', empty ? 'italic text-faint' : 'text-body')}
                        title={value ?? undefined}
                      >
                        {empty ? 'vacío' : value}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={table.header.length + 1} className="px-3 py-6 text-center text-faint">
                  Ninguna fila coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-fill px-3 py-2">
          <span className="text-[11px] text-faint">
            Página {(safePage + 1).toLocaleString('es-ES')} de {totalPages.toLocaleString('es-ES')}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={safePage === 0}
              className="rounded-md border border-field px-2 py-1 text-[11px] text-body transition-colors hover:bg-card disabled:opacity-40"
            >
              Primera
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              aria-label="Página anterior"
              className="rounded-md border border-field p-1 text-body transition-colors hover:bg-card disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              aria-label="Página siguiente"
              className="rounded-md border border-field p-1 text-body transition-colors hover:bg-card disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={safePage >= totalPages - 1}
              className="rounded-md border border-field px-2 py-1 text-[11px] text-body transition-colors hover:bg-card disabled:opacity-40"
            >
              Última
            </button>
          </div>
        </div>
      )}

      {mismatch && (
        <p className="border-t border-border px-3 py-2 text-[11px] text-faint">
          Aquí se leen {table.rows.length.toLocaleString('es-ES')} filas y el análisis registró{' '}
          {reportedRows!.toLocaleString('es-ES')}.{' '}
          {reportTruncated
            ? 'El analizador cortó la descarga por tamaño, así que sus cifras (nulos, distintos, rangos) cubren solo esa parte. Esta vista sí muestra el archivo completo.'
            : 'La diferencia suele deberse a que el archivo se ha actualizado desde el último análisis.'}
        </p>
      )}
    </div>
  );
}
