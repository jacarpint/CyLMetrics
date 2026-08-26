"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  X, Database, CalendarDays, Search, Filter,
  ChevronLeft, ChevronRight, ArrowUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { FilterContent } from '@/components/layout/FilterContent';
import { compositeScore } from '@/lib/quality';
import { ScoreCircle } from '@/components/ui/score-circle';
import { datasetSlug, cn } from '@/lib/utils';
import type { CatalogStats } from '@/lib/types';
import type { QualityDatasetLite } from '@/lib/quality-report';
import type { FormatState } from '@/lib/availability';
import {
  ANALYSIS_LABELS,
  buildFilterUrl,
  filtersAreActive,
  SORT_OPTIONS,
  PAGE_SIZE_OPTIONS,
  type ActiveFilters,
  type PageSort,
} from '@/lib/catalog-filters';

/**
 * Estado de los archivos de un formato, en su propia etiqueta.
 *
 * Al ojear el catálogo lo relevante es si ese formato se puede descargar, no
 * cuántas celdas vacías tiene; por eso la etiqueta comunica estado y no
 * recuentos.
 *
 * Una sola redacción por estado, que sirve al tooltip y al lector de pantalla.
 * Eran dos tablas con el mismo texto y distinta puntuación, que había que
 * mantener en paralelo para que la etiqueta no dijese dos cosas.
 */
const FORMAT_STATES: Record<FormatState, { style: string; description: string }> = {
  ok: {
    style: 'border-border bg-card text-body',
    description: 'se descarga y abre correctamente',
  },
  parcial: {
    style: 'border-warn-line bg-warn-surface text-warn',
    description: 'algunos archivos de este formato no abren',
  },
  roto: {
    style: 'border-bad-line bg-bad-surface text-bad',
    description: 'ningún archivo de este formato se puede abrir',
  },
  'sin-datos': {
    style: 'border-border bg-card text-faint',
    description: 'sin analizar',
  },
};

function FormatTag({ format, state = 'sin-datos' }: { format: string; state?: FormatState }) {
  const { style, description } = FORMAT_STATES[state];
  return (
    <span
      title={`${format}: ${description}`}
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] leading-4 tracking-tight',
        style
      )}
    >
      {format}
      {/* El color no puede ser el único portador de la información, y `title` no
          llega ni al teclado ni al táctil: el estado va siempre en texto. */}
      <span className="sr-only"> — {description}</span>
    </span>
  );
}

/**
 * Lo mínimo que necesita una tarjeta.
 *
 * Se declara aparte de `Dataset` a propósito: mandar el objeto entero al cliente
 * arrastra campos que la tarjeta no pinta y la lista completa de distribuciones.
 */
export interface CatalogCardData {
  id: string;
  title: string;
  description: string;
  formats: string[];
  updatedAgo: string;
  qualityScore: number | null;
}

function DatasetCard({
  dataset,
  analysis,
}: {
  dataset: CatalogCardData;
  analysis?: QualityDatasetLite;
}) {
  const href = `/catalogo/${datasetSlug(dataset.id)}`;
  const score = compositeScore({
    metadata: dataset.qualityScore,
    availability: analysis?.availability_pct ?? null,
    content: analysis?.score ?? null,
  });

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:border-border-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-strong transition-colors group-hover:text-ok">
          {dataset.title}
        </h3>
        <ScoreCircle score={score} />
      </div>

      {dataset.description && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-faint">{dataset.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <div className="flex flex-wrap gap-1">
          {dataset.formats.map((fmt) => (
            <FormatTag key={fmt} format={fmt} state={analysis?.format_states?.[fmt]} />
          ))}
        </div>
        <span className="shrink-0 text-[11px] text-faint">{dataset.updatedAgo}</span>
      </div>
    </Link>
  );
}

interface CatalogViewProps {
  datasets: CatalogCardData[];
  totalStats: CatalogStats;
  filters: ActiveFilters;
  analysisBySlug?: Record<string, QualityDatasetLite>;
  totalFiltered: number;
  totalPages: number;
}

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function CatalogView({
  datasets, totalStats, filters, analysisBySlug, totalFiltered, totalPages,
}: CatalogViewProps) {
  const router = useRouter();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const isFiltered = filtersAreActive(filters);
  const startIdx = totalFiltered === 0 ? 0 : (filters.page - 1) * filters.limit + 1;
  const endIdx = Math.min(filters.page * filters.limit, totalFiltered);

  /**
   * Navega aplicando un cambio sobre los filtros actuales.
   *
   * Cualquier cambio que no sea de página vuelve a la primera: si acotas o
   * amplías el conjunto de resultados, seguir en la página 7 no significa nada.
   * Por eso el `patch` debe traer SOLO lo que cambia; extenderlo con los filtros
   * completos cuela el `page` actual y anula ese reinicio.
   */
  const navigate = useCallback((patch: Partial<ActiveFilters>) => {
    router.push(buildFilterUrl({ ...filters, ...patch, page: patch.page ?? 1 }));
  }, [filters, router]);

  const clearAll = () => router.push('/catalogo');

  const activeChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];

    filters.categorias.forEach((c) => {
      chips.push({
        key: `cat-${c}`,
        label: c,
        onRemove: () => navigate({ categorias: filters.categorias.filter((v) => v !== c) }),
      });
    });
    filters.formatos.forEach((f) => {
      chips.push({
        key: `fmt-${f}`,
        label: f,
        onRemove: () => navigate({ formatos: filters.formatos.filter((v) => v !== f) }),
      });
    });
    filters.licencias.forEach((l) => {
      chips.push({
        key: `lic-${l}`,
        label: l,
        onRemove: () => navigate({ licencias: filters.licencias.filter((v) => v !== l) }),
      });
    });
    if (filters.geo) {
      chips.push({ key: 'geo', label: 'Solo geoespaciales', onRemove: () => navigate({ geo: undefined }) });
    }
    if (filters.desde) {
      chips.push({ key: 'desde', label: `Desde ${filters.desde}`, onRemove: () => navigate({ desde: undefined }) });
    }
    if (filters.hasta) {
      chips.push({ key: 'hasta', label: `Hasta ${filters.hasta}`, onRemove: () => navigate({ hasta: undefined }) });
    }
    if (filters.q) {
      chips.push({ key: 'q', label: `"${filters.q}"`, onRemove: () => navigate({ q: undefined }) });
    }
    if (filters.analisis) {
      chips.push({
        key: 'analisis',
        label: ANALYSIS_LABELS[filters.analisis],
        onRemove: () => navigate({ analisis: undefined }),
      });
    }
    return chips;
  }, [filters, navigate]);

  const pageNumbers = useMemo(() => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (filters.page > 3) pages.push('...');
      const start = Math.max(2, filters.page - 1);
      const end = Math.min(totalPages - 1, filters.page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (filters.page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, filters.page]);

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-strong">Catálogo de datos</h1>
        <p className="mt-1 text-sm text-faint">
          Datos abiertos de Castilla y León · fuente datosabiertos.jcyl.es
        </p>
      </div>

      {/* Filtros en móvil */}
      <div className="lg:hidden">
        <Button variant="secondary" className="w-full gap-2" onClick={() => setMobileFiltersOpen(true)}>
          <Filter className="h-4 w-4" aria-hidden />
          Filtros
          {isFiltered && (
            <span className="ml-1 rounded-full bg-ok-surface px-1.5 py-0.5 text-[11px] font-semibold text-ok">
              {activeChips.length}
            </span>
          )}
        </Button>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-faint" aria-hidden />
              Filtros
            </SheetTitle>
            <SheetDescription>
              Acota el catálogo por temática, formato, estado de los archivos, licencia o fecha.
            </SheetDescription>
          </SheetHeader>
          {/* Dentro de SheetBody: es la única parte del panel que se desplaza. */}
          <SheetBody>
            <FilterContent stats={totalStats} onApply={() => setMobileFiltersOpen(false)} />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* Filtros activos */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-faint">Filtros activos:</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.onRemove}
              aria-label={`Quitar filtro ${chip.label}`}
              className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-body transition-all hover:border-bad-line hover:bg-bad-surface hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {chip.key === 'desde' || chip.key === 'hasta' ? (
                <CalendarDays className="h-3 w-3 text-faint" aria-hidden />
              ) : chip.key === 'q' ? (
                <Search className="h-3 w-3 text-faint" aria-hidden />
              ) : null}
              {chip.label}
              <X className="h-3 w-3 text-faint group-hover:text-bad" aria-hidden />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="rounded text-xs font-medium text-link underline-offset-2 hover:text-link-hover hover:underline"
          >
            Limpiar todos
          </button>
        </div>
      )}

      {/* Barra de resultados */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-faint" role="status">
          {totalFiltered === 0 ? (
            'Sin resultados'
          ) : (
            <>
              Mostrando <span className="font-semibold text-body">{startIdx}–{endIdx}</span> de{' '}
              <span className="font-semibold text-body">{totalFiltered.toLocaleString('es-ES')}</span>{' '}
              {totalFiltered === 1 ? 'conjunto de datos' : 'conjuntos de datos'}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-faint">
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Ordenar por</span>
            <select
              value={filters.sort}
              onChange={(e) => navigate({ sort: e.target.value as PageSort })}
              className="rounded-lg border border-field bg-card px-2 py-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-faint">
            <span className="sr-only sm:not-sr-only">Resultados por página</span>
            <select
              value={filters.limit}
              onChange={(e) => navigate({ limit: Number(e.target.value) })}
              aria-label="Resultados por página"
              className="rounded-lg border border-field bg-card px-2 py-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Rejilla de datasets */}
      {datasets.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {datasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              analysis={analysisBySlug?.[datasetSlug(dataset.id)]}
            />
          ))}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-1 pt-2" aria-label="Paginación">
          <Button
            variant="secondary"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => navigate({ page: filters.page - 1 })}
            aria-label="Página anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          {pageNumbers.map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-2 text-faint" aria-hidden>…</span>
            ) : (
              <Button
                key={p}
                variant={p === filters.page ? 'default' : 'secondary'}
                size="sm"
                onClick={() => navigate({ page: p })}
                aria-label={`Página ${p}`}
                aria-current={p === filters.page ? 'page' : undefined}
              >
                {p}
              </Button>
            )
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={filters.page >= totalPages}
            onClick={() => navigate({ page: filters.page + 1 })}
            aria-label="Página siguiente"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </nav>
      )}

      {/* Sin resultados */}
      {datasets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Database className="mb-4 h-12 w-12 text-faint" aria-hidden />
          <h2 className="text-lg font-semibold text-body">No hay conjuntos de datos con estos filtros</h2>
          <p className="mt-1 text-sm text-faint">Prueba a quitar alguno para ampliar la búsqueda.</p>
          <button
            onClick={clearAll}
            className="mt-3 rounded text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline"
          >
            Limpiar todos los filtros
          </button>
        </div>
      )}
    </div>
  );
}
