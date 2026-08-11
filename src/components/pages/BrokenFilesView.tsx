'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Building2, CheckCircle2, ExternalLink, FileWarning,
  Search, Wrench, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DownloadButton } from '@/components/ui/download-button';
import { cn } from '@/lib/utils';
import {
  DELIVERY_EXPLANATIONS, DELIVERY_SHORT, findSystemicCauses, groupByField,
  type BrokenFileRow,
} from '@/lib/availability';

interface BrokenFilesViewProps {
  rows: BrokenFileRow[];
  /** Distribuciones totales por formato en el subconjunto filtrado. */
  formatTotals: Record<string, number>;
  /** Distribuciones totales analizadas en el subconjunto filtrado. */
  totalDistributions: number;
}

type StateFilter = 'todos' | 'roto' | 'no-entrega' | 'omitida';
const PAGE = 50;

const STATE_TONE: Record<BrokenFileRow['state'], { text: string; surface: string; border: string }> = {
  roto: { text: 'text-bad', surface: 'bg-bad-surface', border: 'border-bad-line' },
  'no-entrega': { text: 'text-warn', surface: 'bg-warn-surface', border: 'border-warn-line' },
  omitida: { text: 'text-faint', surface: 'bg-fill', border: 'border-border' },
};

function toCsv(rows: BrokenFileRow[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['estado', 'formato', 'dataset', 'organismo', 'categoria', 'causa', 'codigo_causa', 'http', 'url', 'ficha'];
  const lines = rows.map((r) =>
    [
      DELIVERY_SHORT[r.state], r.format, r.datasetTitle, r.publisher, r.category,
      r.causeLabel, r.causeCode, r.httpStatus ?? '', r.url,
      `/catalogo/${r.datasetSlug}/${r.distIdx}`,
    ].map(esc).join(';')
  );
  // BOM para que Excel en castellano no rompa los acentos.
  return `﻿${header.join(';')}\n${lines.join('\n')}`;
}

export function BrokenFilesView({ rows, formatTotals, totalDistributions }: BrokenFilesViewProps) {
  const [stateFilter, setStateFilter] = useState<StateFilter>('todos');
  const [cause, setCause] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { roto: 0, 'no-entrega': 0, omitida: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const systemic = useMemo(() => findSystemicCauses(rows, formatTotals), [rows, formatTotals]);
  // Por categoría temática y no por organismo: el catálogo declara el mismo
  // organismo en casi todos los datasets, así que ese eje no reparte nada.
  const categories = useMemo(() => groupByField(rows, 'category'), [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== 'todos' && r.state !== stateFilter) return false;
      if (cause && r.causeCode !== cause) return false;
      if (category && r.category !== category) return false;
      if (needle && !`${r.datasetTitle} ${r.category} ${r.format} ${r.url}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, stateFilter, cause, category, query]);

  const shown = filtered.slice(0, limit);
  const hasSubFilter = stateFilter !== 'todos' || Boolean(cause) || Boolean(category) || Boolean(query.trim());

  const clearSubFilters = () => {
    setStateFilter('todos');
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
            <h2 className="text-sm font-semibold text-strong">Ningún fichero con problemas</h2>
            <p className="mt-1 text-sm text-body">
              Todas las distribuciones analizadas del resultado actual se descargan y se abren
              correctamente.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Resumen de disponibilidad ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card tone="bad">
          <CardContent className="p-4">
            <p className="eyebrow mb-1">No se pueden abrir</p>
            <p className="text-2xl font-bold tabular-nums text-bad">{counts.roto.toLocaleString('es-ES')}</p>
            <p className="mt-0.5 text-[11px] text-faint">
              {totalDistributions > 0 ? `${Math.round((counts.roto / totalDistributions) * 100)}% de las distribuciones` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card tone="warn">
          <CardContent className="p-4">
            <p className="eyebrow mb-1">No entregan archivo</p>
            <p className="text-2xl font-bold tabular-nums text-warn">{counts['no-entrega'].toLocaleString('es-ES')}</p>
            <p className="mt-0.5 text-[11px] text-faint">la URL devuelve una página web</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow mb-1">Datasets afectados</p>
            <p className="text-2xl font-bold tabular-nums text-strong">
              {new Set(rows.map((r) => r.datasetSlug)).size.toLocaleString('es-ES')}
            </p>
            <p className="mt-0.5 text-[11px] text-faint">con al menos un fichero</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="eyebrow mb-1">Causas distintas</p>
            <p className="text-2xl font-bold tabular-nums text-strong">{systemic.length.toLocaleString('es-ES')}</p>
            <p className="mt-0.5 text-[11px] text-faint">combinaciones formato · fallo</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Causas sistémicas ── */}
      {systemic.length > 0 && (
        <section>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-strong">
            <Wrench className="h-4 w-4 text-faint" aria-hidden />
            Qué arreglar primero
          </h2>
          <p className="mb-3 text-xs text-faint">
            Un mismo fallo repetido en muchos recursos no son N incidencias: es una. Ordenado por
            recursos que se recuperan al corregirlo.
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {systemic.slice(0, 6).map((c) => (
              <Card key={c.key} tone={c.wholeFormat ? 'bad' : 'default'}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant="format">{c.format}</Badge>
                        {c.wholeFormat && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-bad">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> Formato entero
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-strong">{c.causeLabel}</p>
                      <p className="mt-1 text-xs text-faint">
                        {c.affected} de {c.formatTotal} recursos {c.format} · {c.datasets}{' '}
                        {c.datasets === 1 ? 'dataset' : 'datasets'}
                      </p>
                      {c.wholeFormat && (
                        <p className="mt-2 text-xs leading-relaxed text-body">
                          Falla en <strong>todos</strong> los recursos del formato: apunta a un proceso de
                          publicación roto, no a {c.affected} problemas independientes.
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setCause(c.causeCode); setStateFilter('todos'); setLimit(PAGE); }}
                      className="shrink-0 rounded-lg border border-field px-2.5 py-1 text-xs font-medium text-body transition-colors hover:bg-fill"
                    >
                      Ver {c.affected}
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Áreas temáticas más afectadas ── */}
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="Filtrar por estado">
            {([
              ['todos', `Todos (${rows.length})`],
              ['roto', `Rotos (${counts.roto})`],
              ['no-entrega', `No entregan (${counts['no-entrega']})`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setStateFilter(id); setLimit(PAGE); }}
                aria-pressed={stateFilter === id}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  stateFilter === id ? 'bg-primary text-primary-fg' : 'text-body hover:bg-fill'
                )}
              >
                {label}
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
            filename="ficheros-con-problemas.csv"
            mimeType="text/csv;charset=utf-8"
            label={`Descargar CSV (${filtered.length.toLocaleString('es-ES')})`}
          />
        </div>

        {hasSubFilter && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-faint">
              Mostrando {filtered.length.toLocaleString('es-ES')} de {rows.length.toLocaleString('es-ES')}
            </span>
            {cause && (
              <button onClick={() => setCause('')} className="inline-flex items-center gap-1 rounded-md border border-border bg-fill px-2 py-0.5 text-body hover:bg-fill-strong">
                causa: {rows.find((r) => r.causeCode === cause)?.causeLabel ?? cause}
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
              <caption className="sr-only">Distribuciones que no se pueden descargar o abrir</caption>
              <thead>
                <tr className="border-b border-border bg-fill text-left">
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Estado</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Formato</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Dataset</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold text-faint lg:table-cell">Área temática</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint">Causa</th>
                  <th scope="col" className="px-3 py-2 font-semibold text-faint"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const id = `${r.datasetSlug}-${r.distIdx}`;
                  const tone = STATE_TONE[r.state];
                  const isOpen = expanded === id;
                  return (
                    <tr key={id} className="border-b border-border last:border-0 align-top hover:bg-fill">
                      <td className="px-3 py-2">
                        <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium', tone.border, tone.surface, tone.text)}>
                          {r.state === 'roto' ? <AlertTriangle className="h-3 w-3" aria-hidden /> : <FileWarning className="h-3 w-3" aria-hidden />}
                          {DELIVERY_SHORT[r.state]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="format" className="text-[10px]">{r.format}</Badge>
                      </td>
                      <td className="max-w-[26rem] px-3 py-2">
                        <Link
                          href={`/catalogo/${r.datasetSlug}/${r.distIdx}`}
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
                          {isOpen ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />}
                          <span>
                            {r.causeLabel}
                            {r.httpStatus ? <span className="ml-1 text-faint">HTTP {r.httpStatus}</span> : null}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mt-2 space-y-1.5 rounded-md border border-border bg-card p-2">
                            <p className="text-[11px] leading-relaxed text-body">{DELIVERY_EXPLANATIONS[r.state]}</p>
                            {r.note && <p className="text-[11px] leading-relaxed text-faint">{r.note}</p>}
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
    </div>
  );
}
