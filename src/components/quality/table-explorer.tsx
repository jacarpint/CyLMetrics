'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronLeft, ChevronRight, ExternalLink, Search, X,
  Table2, Columns3, TriangleAlert, Locate, type LucideIcon,
} from 'lucide-react';
import { SchemaTable } from '@/components/quality/schema-explorer';
import { columnProfiles, findTabularIssues, type Occurrence } from '@/lib/tabular-analysis';
import { unitWords, capitalize, type UnitVoice } from '@/lib/unit-words';
import { cn } from '@/lib/utils';

const ROWS_PER_PAGE = 50;

export interface ExtraTab {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
}

export interface TableExplorerProps {
  header: string[];
  rows: string[][];
  /** Vocabulario: una tabla tiene filas y columnas; un JSON o un mapa, registros y campos. */
  voice: UnitVoice;
  /** Etiqueta de la primera pestaña: «Datos», «Entidades»… */
  dataLabel?: string;
  /** Texto informativo a la derecha de las pestañas. */
  summary?: ReactNode;
  /** Controles propios del formato (selector de hoja o de capa). */
  controls?: ReactNode;
  /** Aviso al pie de la pestaña de incidencias. */
  footnote?: ReactNode;
  /** Pestañas añadidas por el formato (el árbol de un JSON, por ejemplo). */
  extraTabs?: ExtraTab[];
  downloadUrl?: string;
  /** Fila resaltada desde fuera —el mapa— y su notificación de vuelta. */
  selectedRow?: number | null;
  onSelectRow?: (index: number | null) => void;
}

/**
 * Vista común de cualquier cosa que se pueda reducir a un encabezado y unas
 * filas: los datos, el perfil de cada columna y las incidencias, con recorrido
 * caso por caso.
 *
 * La usan por igual el explorador de archivos (CSV, XLSX, JSON) y el de
 * entidades del mapa, para que explorar un shapefile se parezca a explorar un
 * CSV en vez de ser otra interfaz distinta. Quien la usa se ocupa de conseguir
 * los datos; aquí solo se presentan.
 */
export function TableExplorer({
  header,
  rows,
  voice,
  dataLabel = 'Datos',
  summary,
  controls,
  footnote,
  extraTabs = [],
  downloadUrl,
  selectedRow = null,
  onSelectRow,
}: TableExplorerProps) {
  const words = unitWords(voice);
  const tabsId = useId();

  const [tab, setTab] = useState<string>('datos');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [tracking, setTracking] = useState<{ code: string; index: number } | null>(null);
  const activeRowRef = useRef<HTMLTableRowElement>(null);

  const profiles = useMemo(() => columnProfiles(header, rows), [header, rows]);
  const issues = useMemo(() => findTabularIssues(header, rows, voice), [header, rows, voice]);

  const activeIssue = tracking ? issues.find((i) => i.code === tracking.code) ?? null : null;
  const activeOccurrence: Occurrence | null = activeIssue?.occurrences[tracking!.index] ?? null;

  /** Celdas resaltadas, indexadas por «fila:columna». */
  const highlighted = useMemo(() => {
    if (!activeIssue) return new Set<string>();
    return new Set(activeIssue.occurrences.map((o) => `${o.row}:${o.col}`));
  }, [activeIssue]);

  const goToOccurrence = useCallback((code: string, index: number) => {
    const issue = issues.find((i) => i.code === code);
    if (!issue || issue.occurrences.length === 0) return;
    const safe = (index + issue.occurrences.length) % issue.occurrences.length;
    const occurrence = issue.occurrences[safe];
    setTracking({ code, index: safe });
    setQuery('');            // filtrar cambiaría los índices de fila
    setTab('datos');
    setPage(occurrence.row >= 0 ? Math.floor(occurrence.row / ROWS_PER_PAGE) : 0);
  }, [issues]);

  // Durante el recorrido, las flechas del teclado saltan de caso: con miles de
  // ocurrencias, ir al ratón hasta los botones cada vez es inviable.
  useEffect(() => {
    if (!tracking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'Escape') { setTracking(null); return; }
      e.preventDefault();
      goToOccurrence(tracking.code, tracking.index + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tracking, goToOccurrence]);

  // Una selección hecha en el mapa tiene que traer su fila a la vista. El
  // ajuste se hace durante el render y no en un efecto: así React lo resuelve
  // antes de pintar, sin el render en cascada que provocaría un `useEffect`.
  const [lastSelected, setLastSelected] = useState(selectedRow);
  if (selectedRow !== lastSelected) {
    setLastSelected(selectedRow);
    if (selectedRow !== null) {
      setTracking(null);
      setQuery('');
      setTab('datos');
      setPage(Math.floor(selectedRow / ROWS_PER_PAGE));
    }
  }

  // Al saltar de caso o de entidad, se lleva la fila a la vista. Es una llamada
  // al DOM, no un cambio de estado, así que no dispara renders en cascada.
  const focusRow = activeOccurrence?.row ?? selectedRow;
  useEffect(() => {
    if (focusRow != null && focusRow >= 0) {
      activeRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focusRow, page]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows.map((row, index) => ({ row, index }));
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.some((cell) => cell.toLowerCase().includes(needle)));
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE + ROWS_PER_PAGE);
  const totalIssues = issues.reduce((n, i) => n + i.occurrences.length, 0);

  const TABS: { id: string; label: string; icon: LucideIcon; badge?: number }[] = [
    { id: 'datos', label: dataLabel, icon: Table2 },
    { id: 'columnas', label: capitalize(words.cols), icon: Columns3, badge: header.length },
    { id: 'incidencias', label: 'Incidencias', icon: TriangleAlert, badge: totalIssues || undefined },
    ...extraTabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
  ];
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'datos';
  const isLastPanel = (id: string) => TABS[TABS.length - 1].id === id;

  return (
    // Sin `overflow-hidden`: recortaría la barra de recorrido y dejaría de
    // poder quedarse fija al hacer scroll.
    <div className="rounded-xl border border-border bg-card">
      {/* Pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-border bg-fill px-3 py-2">
        {/* Patrón de pestañas completo: cada botón declara el panel que controla
            y las flechas mueven el foco entre pestañas, como espera un lector de
            pantalla. Antes solo estaban los roles, sin `aria-controls` ni
            paneles asociados. */}
        <div
          className="flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Vistas del recurso"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const ids = TABS.map((t) => t.id);
            const current = ids.indexOf(activeTab);
            const next = (current + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
            e.preventDefault();
            setTab(ids[next]);
            document.getElementById(`${tabsId}-tab-${ids[next]}`)?.focus();
          }}
        >
          {TABS.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              id={`${tabsId}-tab-${id}`}
              role="tab"
              type="button"
              aria-selected={activeTab === id}
              aria-controls={`${tabsId}-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                activeTab === id ? 'bg-card text-strong shadow-sm' : 'text-body hover:bg-card/60'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
              {badge != null && <span className="tabular-nums text-faint">{badge.toLocaleString('es-ES')}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {summary && <span className="text-[11px] text-faint">{summary}</span>}
        </div>
      </div>

      {/* ── Barra de recorrido de una incidencia ──────────────────────────
          Queda fija bajo la cabecera del sitio: con miles de ocurrencias, tener
          que volver arriba para pulsar «siguiente» hacía el recorrido inútil. */}
      {activeIssue && (
        <div className={cn(
          'sticky top-[4.5rem] z-20 flex flex-wrap items-center gap-3 border-y px-3 py-2 shadow-sm',
          activeIssue.severity === 'error' ? 'border-bad-line bg-bad-surface' : 'border-warn-line bg-warn-surface'
        )}>
          <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold',
            activeIssue.severity === 'error' ? 'text-bad' : 'text-warn')}>
            <Locate className="h-3.5 w-3.5" aria-hidden />
            {activeIssue.label}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToOccurrence(activeIssue.code, tracking!.index - 1)}
              aria-label="Caso anterior"
              className="rounded-md border border-field bg-card p-1 text-body transition-colors hover:bg-fill"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span className="min-w-[7rem] text-center text-xs tabular-nums text-body" role="status">
              {(tracking!.index + 1).toLocaleString('es-ES')} de {activeIssue.occurrences.length.toLocaleString('es-ES')}
            </span>
            <button
              type="button"
              onClick={() => goToOccurrence(activeIssue.code, tracking!.index + 1)}
              aria-label="Caso siguiente"
              className="rounded-md border border-field bg-card p-1 text-body transition-colors hover:bg-fill"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {activeOccurrence && (
            <span className="text-[11px] text-faint">
              {activeOccurrence.row >= 0
                ? `${words.row} ${(activeOccurrence.row + 1).toLocaleString('es-ES')}`
                : 'encabezado'} · {words.col}{' '}
              <strong className="font-medium text-body">{header[activeOccurrence.col]}</strong>
            </span>
          )}
          <span className="hidden text-[11px] text-faint lg:inline">
            Usa <kbd className="rounded border border-field bg-card px-1 font-sans">←</kbd>{' '}
            <kbd className="rounded border border-field bg-card px-1 font-sans">→</kbd> para avanzar
          </span>
          <button
            type="button"
            onClick={() => setTracking(null)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-faint transition-colors hover:bg-card hover:text-body"
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Salir del recorrido
          </button>
        </div>
      )}

      {/* ── Datos ── */}
      {activeTab === 'datos' && (
        <div id={`${tabsId}-panel-datos`} role="tabpanel" aria-labelledby={`${tabsId}-tab-datos`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
              <input
                type="search"
                value={query}
                disabled={Boolean(activeIssue)}
                onChange={(e) => { setQuery(e.target.value); setPage(0); }}
                placeholder={activeIssue ? 'Búsqueda desactivada al recorrer' : `Buscar en ${voice === 'record' ? 'todos los registros' : 'todas las filas'}…`}
                aria-label="Buscar dentro del recurso"
                className="h-8 w-full rounded-lg border border-field bg-card pl-8 pr-7 text-xs text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50"
              />
              {query && (
                <button type="button" onClick={() => { setQuery(''); setPage(0); }} aria-label="Limpiar búsqueda"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-body">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            {query && (
              <span className="text-[11px] text-faint" role="status">
                {filtered.length.toLocaleString('es-ES')} de {rows.length.toLocaleString('es-ES')} {words.rows}
              </span>
            )}
            {onSelectRow && selectedRow !== null && (
              <button
                type="button"
                onClick={() => onSelectRow(null)}
                className="inline-flex items-center gap-1 rounded-md border border-field px-2 py-1 text-[11px] text-body transition-colors hover:bg-fill"
              >
                <X className="h-3 w-3" aria-hidden /> Quitar selección del mapa
              </button>
            )}
            {downloadUrl && (
              <a href={downloadUrl} target="_blank" rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-faint transition-colors hover:bg-fill hover:text-body">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Descargar
              </a>
            )}
          </div>

          <div className={cn('overflow-x-auto', totalPages === 1 && 'rounded-b-xl')}>
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="border-b border-border bg-fill text-left">
                  <th scope="col" className="w-16 px-2.5 py-2 font-semibold text-faint">#</th>
                  {header.map((name, i) => (
                    <th key={i} scope="col"
                      className={cn('max-w-[18rem] truncate px-2.5 py-2 font-semibold',
                        activeOccurrence?.col === i ? 'bg-fill-strong text-strong' : 'text-body')}
                      title={name}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, index }) => {
                  const isOccurrenceRow = activeOccurrence?.row === index;
                  const isSelected = selectedRow === index;
                  const isFocused = isOccurrenceRow || isSelected;
                  return (
                    <tr
                      key={index}
                      ref={isFocused ? activeRowRef : undefined}
                      onClick={onSelectRow ? () => onSelectRow(isSelected ? null : index) : undefined}
                      aria-selected={onSelectRow ? isSelected : undefined}
                      className={cn(
                        'border-b border-border last:border-0',
                        onSelectRow && 'cursor-pointer',
                        isSelected ? 'bg-warn-surface' : isOccurrenceRow ? 'bg-fill' : 'hover:bg-fill'
                      )}
                    >
                      <td className={cn('px-2.5 py-1.5 tabular-nums', isSelected ? 'font-semibold text-warn' : 'text-faint')}>
                        {(index + 1).toLocaleString('es-ES')}
                      </td>
                      {header.map((_, ci) => {
                        const value = row[ci];
                        const empty = value == null || value.trim() === '';
                        const marked = highlighted.has(`${index}:${ci}`);
                        const isCurrent = isOccurrenceRow && activeOccurrence?.col === ci;
                        return (
                          <td
                            key={ci}
                            className={cn(
                              'max-w-[18rem] truncate px-2.5 py-1.5',
                              marked && (activeIssue?.severity === 'error' ? 'bg-bad-surface text-bad' : 'bg-warn-surface text-warn'),
                              isCurrent && 'ring-2 ring-inset ring-ring font-semibold',
                              !marked && (empty ? 'italic text-faint' : 'text-body')
                            )}
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
                    <td colSpan={header.length + 1} className="px-3 py-6 text-center text-faint">
                      Ningún {words.row} coincide con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-border bg-fill px-3 py-2">
              <span className="text-[11px] text-faint">
                Página {(safePage + 1).toLocaleString('es-ES')} de {totalPages.toLocaleString('es-ES')}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(0)} disabled={safePage === 0}
                  className="rounded-md border border-field px-2 py-1 text-[11px] text-body transition-colors hover:bg-card disabled:opacity-40">
                  Primera
                </button>
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} aria-label="Página anterior"
                  className="rounded-md border border-field p-1 text-body transition-colors hover:bg-card disabled:opacity-40">
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1} aria-label="Página siguiente"
                  className="rounded-md border border-field p-1 text-body transition-colors hover:bg-card disabled:opacity-40">
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1}
                  className="rounded-md border border-field px-2 py-1 text-[11px] text-body transition-colors hover:bg-card disabled:opacity-40">
                  Última
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Columnas / Campos ── */}
      {activeTab === 'columnas' && (
        <div
          id={`${tabsId}-panel-columnas`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-columnas`}
          className={cn('p-3', isLastPanel('columnas') && 'rounded-b-xl')}
        >
          <p className="mb-3 text-[11px] text-faint">
            Tipo, nulos, valores distintos y rango calculados sobre {voice === 'record' ? 'los' : 'las'}{' '}
            {rows.length.toLocaleString('es-ES')} {words.rows} del archivo, sin muestreo ni topes.
          </p>
          <SchemaTable schema={profiles} />
        </div>
      )}

      {/* ── Incidencias ── */}
      {activeTab === 'incidencias' && (
        <div
          id={`${tabsId}-panel-incidencias`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-incidencias`}
          className={cn('space-y-3 p-3', isLastPanel('incidencias') && 'rounded-b-xl')}
        >
          {issues.length === 0 ? (
            <p className="rounded-lg border border-ok-line bg-ok-surface px-3 py-2.5 text-sm text-ok">
              Sin incidencias de estructura ni de tipos en este recurso.
            </p>
          ) : (
            issues.map((issue) => (
              <div
                key={issue.code}
                className={cn('rounded-lg border p-3',
                  issue.severity === 'error' ? 'border-bad-line bg-bad-surface' : 'border-warn-line bg-warn-surface')}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-strong">
                      <span className={cn('text-lg font-bold tabular-nums',
                        issue.severity === 'error' ? 'text-bad' : 'text-warn')}>
                        {issue.occurrences.length.toLocaleString('es-ES')}
                      </span>
                      {issue.label}
                    </p>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-body">{issue.rule}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToOccurrence(issue.code, 0)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-field bg-card px-2.5 py-1.5 text-xs font-medium text-body transition-colors hover:bg-fill"
                  >
                    <Locate className="h-3.5 w-3.5" aria-hidden />
                    Recorrer los casos
                  </button>
                </div>
              </div>
            ))
          )}
          {footnote}
        </div>
      )}

      {/* ── Pestañas propias del formato ── */}
      {extraTabs.map((t) =>
        activeTab === t.id ? (
          <div
            key={t.id}
            id={`${tabsId}-panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${t.id}`}
          >
            {t.content}
          </div>
        ) : null
      )}
    </div>
  );
}
