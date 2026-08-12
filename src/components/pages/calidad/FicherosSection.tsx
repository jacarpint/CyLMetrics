'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Building2, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileWarning,
  Search, SearchCode, Table2, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DownloadButton } from '@/components/ui/download-button';
import { cn } from '@/lib/utils';
import { issueLabel, formatBytes } from '@/lib/quality-labels';
import { isGeoFormat } from '@/lib/geo';
import {
  DELIVERY_EXPLANATIONS, DELIVERY_SHORT, groupByField,
  type FileIssueRow, type IssueFamily,
} from '@/lib/availability';
import type { FormatSummary } from '@/lib/quality-report';

interface FicherosSectionProps {
  rows: FileIssueRow[];
  /** Notas del analizador sin repetir; las filas apuntan por `noteIdx`. */
  notes: string[];
  /** Resultados por formato del informe, para el bloque plegado. */
  byFormat: [string, FormatSummary][];
  /** Familia preseleccionada al llegar desde un enlace de Prioridades. */
  initialFamily?: IssueFamily | 'todas';
  /** Causa preseleccionada al llegar desde un enlace de Prioridades. */
  initialCause?: string;
}

type FamilyFilter = 'todas' | IssueFamily;
const PAGE = 50;

const FAMILY_TABS: { id: FamilyFilter; label: string; hint: string }[] = [
  { id: 'todas', label: 'Todos', hint: 'Todos los ficheros con algún defecto' },
  { id: 'entrega', label: 'No se pueden usar', hint: 'No llegan, o llegan y no se pueden interpretar' },
  { id: 'contenido', label: 'Abren con errores', hint: 'Se pueden leer, pero los datos vienen con errores' },
];

/** Tono de la etiqueta de estado de cada fila. */
const ROW_TONE: Record<string, { text: string; surface: string; border: string }> = {
  roto: { text: 'text-bad', surface: 'bg-bad-surface', border: 'border-bad-line' },
  'no-entrega': { text: 'text-warn', surface: 'bg-warn-surface', border: 'border-warn-line' },
  omitida: { text: 'text-faint', surface: 'bg-fill', border: 'border-border' },
  ok: { text: 'text-warn', surface: 'bg-warn-surface', border: 'border-warn-line' },
};

/** Etiqueta corta de la fila: el estado de entrega, o «contenido» si abre. */
function rowStateLabel(row: FileIssueRow): string {
  return row.family === 'contenido' ? 'Contenido' : DELIVERY_SHORT[row.state];
}

function toCsv(rows: FileIssueRow[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'familia', 'estado', 'formato', 'dataset', 'categoria', 'causa', 'codigo_causa',
    'errores_contenido', 'http', 'url', 'ficha',
  ];
  const lines = rows.map((r) =>
    [
      r.family, rowStateLabel(r), r.format, r.datasetTitle, r.category,
      issueLabel(r.causeCode), r.causeCode, r.errorIssues ?? '', r.httpStatus ?? '', r.url,
      `/catalogo/${r.datasetSlug}/${r.distSlug}`,
    ].map(esc).join(';')
  );
  // BOM para que Excel en castellano no rompa los acentos.
  return `﻿${header.join(';')}\n${lines.join('\n')}`;
}

/**
 * Todos los ficheros con algún defecto, explorables en una sola tabla.
 *
 * Antes esta vista solo traía los que no se pueden usar, y los ~328 que abren con
 * errores de contenido vivían en una lista de alertas agrupada por dataset: no se
 * podían filtrar por causa, ni buscar, ni exportar. Ahora las dos familias
 * comparten tabla y se separan con un filtro, porque son dos trabajos distintos
 * —restablecer un enlace o limpiar una columna— sobre el mismo inventario.
 */
export function FicherosSection({
  rows, notes, byFormat, initialFamily = 'todas', initialCause = '',
}: FicherosSectionProps) {
  const [family, setFamily] = useState<FamilyFilter>(initialFamily);
  const [cause, setCause] = useState<string>(initialCause);
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { todas: rows.length, entrega: 0, contenido: 0 };
    for (const r of rows) c[r.family]++;
    return c;
  }, [rows]);

  // Por categoría temática y no por organismo: el catálogo declara el mismo
  // organismo en casi todos los datasets, así que ese eje no reparte nada.
  const categories = useMemo(() => groupByField(rows, 'category'), [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (family !== 'todas' && r.family !== family) return false;
      if (cause && r.causeCode !== cause) return false;
      if (category && r.category !== category) return false;
      if (needle && !`${r.datasetTitle} ${r.category} ${r.format} ${r.url}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, family, cause, category, query]);

  const shown = filtered.slice(0, limit);
  const hasSubFilter =
    family !== 'todas' || Boolean(cause) || Boolean(category) || Boolean(query.trim());

  const clearSubFilters = () => {
    setFamily('todas');
    setCause('');
    setCategory('');
    setQuery('');
    setLimit(PAGE);
  };

  if (rows.length === 0) {
    return (
      <Card tone="ok">
        <CardContent className="flex items-start gap-3 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-strong">Ningún fichero con defectos</h2>
            <p className="mt-1 text-sm text-body">
              Todas las distribuciones analizadas se descargan, se abren y no traen errores de
              contenido.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-faint">
        Inventario completo, fichero a fichero. Cada fila enlaza con su ficha, donde el explorador
        descarga el archivo real y permite recorrer las incidencias caso por caso. Las celdas vacías
        no generan fila propia —son el 98% de las incidencias del catálogo y ahogarían la lista—: se
        revisan en la ficha de cada distribución.
      </p>

      {/* ── Filtro por familia: son dos trabajos distintos ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="Filtrar por tipo de defecto">
          {FAMILY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setFamily(tab.id); setLimit(PAGE); }}
              aria-pressed={family === tab.id}
              title={tab.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                family === tab.id ? 'bg-primary text-primary-fg' : 'text-body hover:bg-fill'
              )}
            >
              {tab.id === 'entrega' && <FileWarning className="h-3.5 w-3.5" aria-hidden />}
              {tab.id === 'contenido' && <SearchCode className="h-3.5 w-3.5" aria-hidden />}
              {tab.label}
              <span className="tabular-nums opacity-70">{counts[tab.id].toLocaleString('es-ES')}</span>
            </button>
          ))}
        </div>

        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
            placeholder="Filtrar por dataset, área o URL…"
            aria-label="Filtrar la lista de ficheros"
            className="h-9 w-full rounded-lg border border-field bg-card pl-8 pr-3 text-xs text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
        </div>

        {/* El CSV se genera al pulsar, respetando los filtros activos. */}
        <DownloadButton
          content={() => toCsv(filtered)}
          filename="ficheros-con-defectos.csv"
          mimeType="text/csv;charset=utf-8"
          label={`Descargar CSV (${filtered.length.toLocaleString('es-ES')})`}
        />
      </div>

      {/* ── Áreas temáticas ── */}
      {categories.length > 1 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
            <Building2 className="h-4 w-4 text-faint" aria-hidden />
            Áreas temáticas más afectadas
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.slice(0, 10).map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { setCategory(category === c.value ? '' : c.value); setLimit(PAGE); }}
                aria-pressed={category === c.value}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                  category === c.value
                    ? 'border-primary bg-primary text-primary-fg'
                    : 'border-border bg-card text-body hover:border-border-strong hover:bg-fill'
                )}
              >
                <span className="max-w-[24ch] truncate">{c.value}</span>
                <span className={cn('tabular-nums', category === c.value ? 'opacity-80' : 'text-faint')}>
                  {c.affected}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Tabla ── */}
      <section>
        {hasSubFilter && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint">
              Mostrando {filtered.length.toLocaleString('es-ES')} de {rows.length.toLocaleString('es-ES')}
            </span>
            {cause && (
              <button onClick={() => setCause('')} className="inline-flex items-center gap-1 rounded-md border border-border bg-fill px-2 py-0.5 text-body hover:bg-fill-strong">
                causa: {issueLabel(cause)}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            {category && (
              <button onClick={() => setCategory('')} className="inline-flex items-center gap-1 rounded-md border border-border bg-fill px-2 py-0.5 text-body hover:bg-fill-strong">
                área: {category}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            <button onClick={clearSubFilters} className="font-medium text-link underline-offset-2 hover:underline">
              Quitar filtros
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <Card tone="muted">
            <CardContent className="p-6 text-center text-sm text-faint">
              Ningún fichero coincide con estos filtros.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Distribuciones con defectos de entrega o de contenido</caption>
              <thead>
                <tr className="border-b border-border bg-fill text-left">
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Estado</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Formato</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Dataset</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold text-faint lg:table-cell">Área temática</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Qué le pasa</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const id = `${r.datasetSlug}-${r.distSlug}-${r.family}`;
                  const tone = ROW_TONE[r.family === 'contenido' ? 'ok' : r.state];
                  const isOpen = expanded === id;
                  return (
                    <tr key={id} className="border-b border-border last:border-0 align-top hover:bg-fill">
                      <td className="px-3 py-2">
                        <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', tone.border, tone.surface, tone.text)}>
                          {r.family === 'contenido'
                            ? <SearchCode className="h-3 w-3" aria-hidden />
                            : <FileWarning className="h-3 w-3" aria-hidden />}
                          {rowStateLabel(r)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="format" className="text-[10px]">{r.format}</Badge>
                      </td>
                      <td className="max-w-[26rem] px-3 py-2">
                        <Link
                          href={`/catalogo/${r.datasetSlug}/${r.distSlug}`}
                          className="line-clamp-2 font-medium text-body underline-offset-2 hover:text-link hover:underline"
                        >
                          {r.datasetTitle}
                        </Link>
                        <p className="mt-0.5 truncate text-[10px] text-faint lg:hidden">{r.category}</p>
                      </td>
                      <td className="hidden max-w-[16rem] px-3 py-2 text-faint lg:table-cell">
                        <span className="line-clamp-2">{r.category}</span>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : id)}
                          aria-expanded={isOpen}
                          className="flex items-start gap-1 text-left text-body hover:text-strong"
                        >
                          {isOpen
                            ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />
                            : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />}
                          <span>
                            {issueLabel(r.causeCode)}
                            {r.httpStatus ? <span className="ml-1 text-faint">HTTP {r.httpStatus}</span> : null}
                            {r.errorIssues != null && r.errorIssues > 1 && (
                              <span className="ml-1 text-faint">
                                y {(r.errorIssues - 1).toLocaleString('es-ES')} más
                              </span>
                            )}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mt-2 space-y-1.5 rounded-md border border-border bg-card p-2">
                            <p className="text-[11px] leading-relaxed text-body">
                              {r.family === 'contenido'
                                ? 'El fichero se descarga y se abre; el problema está en los datos. Se puede reutilizar, pero obliga a limpiar antes.'
                                : DELIVERY_EXPLANATIONS[r.state as Exclude<typeof r.state, 'ok'>]}
                            </p>
                            {r.noteIdx != null && notes[r.noteIdx] && (
                              <p className="text-[11px] leading-relaxed text-faint">{notes[r.noteIdx]}</p>
                            )}
                            <p className="break-all font-mono text-[10px] text-faint">{r.url}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded p-1 text-faint transition-colors hover:bg-fill hover:text-body"
                          aria-label={`Abrir el recurso original de ${r.datasetTitle}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length > shown.length && (
              <div className="border-t border-border bg-fill p-3 text-center">
                <button
                  onClick={() => setLimit((n) => n + PAGE * 2)}
                  className="rounded-lg border border-field bg-card px-3 py-1.5 text-xs font-medium text-body transition-colors hover:bg-fill"
                >
                  Mostrar más ({(filtered.length - shown.length).toLocaleString('es-ES')} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Resultados por formato, plegado ── */}
      {byFormat.length > 0 && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-sm font-semibold text-strong">
            <Table2 className="h-4 w-4 text-faint" aria-hidden />
            Resultados por formato
            <span className="text-[11px] font-normal text-faint">({byFormat.length} formatos)</span>
          </summary>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-faint">
                  <th scope="col" className="px-5 py-2 font-medium">Formato</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Sin incidencias</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Con errores</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Omitidas</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Calidad media</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Descargado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byFormat.map(([fmt, f]) => (
                  <tr key={fmt} className="hover:bg-fill">
                    <td className="px-5 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant="format">{fmt}</Badge>
                        {isGeoFormat(fmt) && <span className="text-[10px] text-faint">geo</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-body">{f.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ok">{f.ok}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-warn">{f.error}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-faint">{f.skipped}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-body">
                      {f.avg_score != null ? `${f.avg_score}%` : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-faint">{formatBytes(f.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 py-3 text-[11px] leading-relaxed text-faint">
              «Con errores» son las distribuciones con alguna incidencia de severidad error según el
              analizador, incluidas las que se descargan y abren sin problema. Es el contador del
              motor de análisis, no el de ficheros inutilizables.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
