"use client";

import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  TrendingUp, X, Database, ExternalLink, CalendarDays, Search,
  CheckCircle2, AlertTriangle, XCircle, FileSearch, Filter,
  ChevronLeft, ChevronRight, ArrowUpDown, LayoutGrid, MapPin, FileWarning,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FilterContent } from '@/components/layout/FilterContent';
import LeafletMapWrapper from '@/components/quality/leaflet-map-wrapper';
import { BrokenFilesView } from '@/components/pages/BrokenFilesView';
import { getScoreColor, getScoreBorderColor, getStatusBadgeVariant, combineScore } from '@/lib/quality';
import { datasetSlug, cn } from '@/lib/utils';
import type { CatalogData, CatalogStats, GeoDataset } from '@/lib/types';
import type { QualityDatasetLite } from '@/lib/quality-report';
import type { BrokenFileRow } from '@/lib/availability';
import {
  buildFilterUrl,
  filtersAreActive,
  withVista,
  SORT_OPTIONS,
  PAGE_SIZE_OPTIONS,
  type ActiveFilters,
  type CatalogVista,
  type PageSort,
} from '@/lib/catalog-filters';

/** Chip de filtro: un único estilo para el conmutador geo y las categorías. */
const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';
const CHIP_ACTIVE = 'border-primary bg-primary text-primary-fg';
const CHIP_IDLE = 'border-border bg-card text-body hover:border-border-strong hover:bg-fill hover:text-strong';

function QualityScoreCircle({ score }: { score: number | null }) {
  const colorClass = score != null ? getScoreColor(score) : 'text-faint';
  const borderClass = score != null ? getScoreBorderColor(score) : 'border-border';
  return (
    <div
      title="Score compuesto de calidad (metadatos + análisis de contenido, 0-100)"
      className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${borderClass} ${colorClass} font-bold text-lg shrink-0`}
    >
      {score ?? '—'}
    </div>
  );
}

function DatasetCard({ dataset, analysis }: { dataset: CatalogData['datasets'][number]; analysis?: QualityDatasetLite }) {
  const href = `/catalogo/${datasetSlug(dataset.id)}`;
  const compositeScore = combineScore(dataset.qualityScore, analysis?.score ?? null);
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ok-line hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      aria-label={`Ver ficha del dataset ${dataset.title}`}
    >
      <div className="p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-snug text-strong transition-colors group-hover:text-ok">
            {dataset.title}
          </h3>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <QualityScoreCircle score={compositeScore} />
            <span
              className="text-[10px] text-faint"
              title="Score compuesto de calidad (metadatos + análisis de contenido, 0-100)"
            >
              Calidad
            </span>
          </div>
        </div>
        <p className="text-xs text-faint mb-4 line-clamp-2 leading-relaxed">
          {dataset.description}
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {dataset.formats.map((fmt) => (
            <Badge key={fmt} variant="format" className="text-[10px]">{fmt}</Badge>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs">
          <Badge variant={getStatusBadgeVariant(dataset.status)}>
            {dataset.statusLabel}
          </Badge>
          <span className="text-faint">{dataset.updatedAgo}</span>
        </div>
        {analysis && (
          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 min-w-0">
              {analysis.status === 'ok' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                  <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden /> Análisis sin fallos
                </span>
              )}
              {analysis.status === 'parcial' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-warn">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {analysis.failed}/{analysis.distributions} con fallos
                </span>
              )}
              {analysis.status === 'error' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-bad">
                  <XCircle className="h-3 w-3 shrink-0" aria-hidden /> {analysis.distributions} dist., todas con fallos
                </span>
              )}
              {analysis.status === 'sin-datos' && (
                <span className="text-[11px] text-faint">Sin análisis de datos</span>
              )}
            </span>
            <span className="inline-flex items-center gap-2 shrink-0">
              {/* Solo los errores llevan chapa. Sumar aquí las advertencias
                  ponía un "9.072 inc." junto a datasets perfectamente usables. */}
              {analysis.error_issues > 0 && (
                <span
                  className="rounded-full bg-bad-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-bad"
                  title={`${analysis.error_issues.toLocaleString('es-ES')} incidencias de tipo error${analysis.warning_issues > 0 ? ` · ${analysis.warning_issues.toLocaleString('es-ES')} advertencias` : ''}`}
                >
                  {analysis.error_issues.toLocaleString('es-ES')} err.
                </span>
              )}
              <span className="inline-flex items-center gap-1" title="Resultado de la auditoría del contenido de las distribuciones (0-100)">
                <FileSearch className="h-3 w-3 text-faint" />
                <span className="text-[11px] text-faint font-semibold tabular-nums">
                  {analysis.status !== 'sin-datos' && analysis.score != null ? `${analysis.score}%` : '—'}
                </span>
              </span>
            </span>
          </div>
        )}
        {analysis && analysis.max_rows != null && analysis.max_rows > 0 && (
          <p className="mt-2 text-[10px] text-faint">
            Hasta {analysis.max_rows.toLocaleString()} filas
            {analysis.max_cols != null ? ` · ${analysis.max_cols} cols` : ''}
          </p>
        )}
        {dataset.distributionUrls.length > 0 && (
          <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-link">
            <ExternalLink className="h-3 w-3" aria-hidden />
            Ver datos
          </span>
        )}
      </div>
    </Link>
  );
}

interface CatalogViewProps {
  datasets: CatalogData['datasets'];
  stats: CatalogStats;
  totalStats: CatalogStats;
  filters: ActiveFilters;
  analysisBySlug?: Record<string, QualityDatasetLite>;
  totalFiltered: number;
  totalPages: number;
  vista: CatalogVista;
  geoDatasets: GeoDataset[];
  /** Distribuciones que no se pueden usar (solo se calcula en vista=ficheros). */
  brokenRows: BrokenFileRow[];
  formatTotals: Record<string, number>;
}

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function CatalogView({
  datasets, stats, totalStats, filters, analysisBySlug,
  totalFiltered, totalPages, vista, geoDatasets, brokenRows, formatTotals,
}: CatalogViewProps) {
  const router = useRouter();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const isFiltered = filtersAreActive(filters);
  const isMap = vista === 'mapa';
  const isFiles = vista === 'ficheros';
  const isCards = vista === 'tarjetas';
  const startIdx = (filters.page - 1) * filters.limit + 1;
  const endIdx = Math.min(filters.page * filters.limit, totalFiltered);

  // Los filtros son comunes a las tres vistas: al cambiarlos se conserva la
  // vista activa, y al cambiar de vista se conservan los filtros.
  const navigate = useCallback((patch: Partial<ActiveFilters>) => {
    router.push(withVista(buildFilterUrl({ ...filters, ...patch, page: patch.page ?? 1 }), vista));
  }, [filters, router, vista]);

  const setVista = (next: CatalogVista) => {
    router.push(withVista(buildFilterUrl(filters), next));
  };

  const VIEWS: { id: CatalogVista; label: string; icon: typeof LayoutGrid }[] = [
    { id: 'tarjetas', label: 'Tarjetas', icon: LayoutGrid },
    { id: 'mapa', label: 'Mapa', icon: MapPin },
    { id: 'ficheros', label: 'Ficheros con problemas', icon: FileWarning },
  ];

  const toggleCategory = (category: string) => {
    const next = filters.categorias.includes(category as never)
      ? filters.categorias.filter((c) => c !== category)
      : [...filters.categorias, category as never];
    navigate({ categorias: next });
  };

  const clearAll = () => router.push('/catalogo');

  const activeChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    const base = { ...filters };

    filters.categorias.forEach((c) => {
      chips.push({
        key: `cat-${c}`,
        label: c,
        onRemove: () => navigate({ ...base, categorias: filters.categorias.filter((v) => v !== c) }),
      });
    });
    filters.formatos.forEach((f) => {
      chips.push({
        key: `fmt-${f}`,
        label: f,
        onRemove: () => navigate({ ...base, formatos: filters.formatos.filter((v) => v !== f) }),
      });
    });
    filters.licencias.forEach((l) => {
      chips.push({
        key: `lic-${l}`,
        label: l,
        onRemove: () => navigate({ ...base, licencias: filters.licencias.filter((v) => v !== l) }),
      });
    });
    if (filters.desde) {
      chips.push({
        key: 'desde',
        label: `Desde ${filters.desde}`,
        onRemove: () => navigate({ ...base, desde: undefined }),
      });
    }
    if (filters.hasta) {
      chips.push({
        key: 'hasta',
        label: `Hasta ${filters.hasta}`,
        onRemove: () => navigate({ ...base, hasta: undefined }),
      });
    }
    if (filters.q) {
      chips.push({
        key: 'q',
        label: `"${filters.q}"`,
        onRemove: () => navigate({ ...base, q: undefined }),
      });
    }
    if (filters.analisis) {
      const labels: Record<string, string> = { ok: 'Sin fallos', parcial: 'Parcial', error: 'Con fallos', 'sin-datos': 'Sin análisis' };
      chips.push({
        key: 'analisis',
        label: `Análisis: ${labels[filters.analisis] ?? filters.analisis}`,
        onRemove: () => navigate({ ...base, analisis: undefined }),
      });
    }
    return chips;
  }, [filters, navigate]);

  const availableCategories = useMemo(
    () =>
      (Object.keys(totalStats.byCategory) as string[]).sort((a, b) =>
        (totalStats.byCategory[b as keyof typeof totalStats.byCategory] ?? 0) -
        (totalStats.byCategory[a as keyof typeof totalStats.byCategory] ?? 0)
      ),
    [totalStats]
  );

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
    <div className="space-y-6">
      {/* Stats Header */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-strong tracking-tight">Catálogo de datos</h1>
            <p className="text-sm text-faint mt-1">
              Datos abiertos de Castilla y León · fuente datosabiertos.jcyl.es
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:flex sm:items-center sm:gap-8">
            <div className="text-right">
              <p className="text-xs text-faint uppercase tracking-wider">
                Datasets
              </p>
              <p className="text-3xl font-bold text-strong mt-1">
                {totalFiltered}
                {isFiltered && <span className="text-base font-medium text-faint"> / {totalStats.totalDatasets}</span>}
              </p>
              <p className="text-[11px] text-faint mt-0.5">
                {isFiltered ? 'con los filtros aplicados' : 'del catálogo completo'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-faint uppercase tracking-wider">
                Calidad media
              </p>
              <div className="mt-1 flex items-center gap-2 sm:justify-end">
                <p className="text-3xl font-bold text-ok">{stats.averageQuality}%</p>
                <TrendingUp className="h-5 w-5 text-ok" aria-hidden />
              </div>
              <p className="text-[11px] text-faint mt-0.5">índice de metadatos (0-100)</p>
            </div>
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-2 mt-5">
          <button
            onClick={() => navigate({ geo: !filters.geo })}
            className={cn(CHIP_BASE, filters.geo ? CHIP_ACTIVE : CHIP_IDLE)}
            aria-pressed={filters.geo}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Solo geoespacial
          </button>
          {availableCategories.map((category) => {
            const active = filters.categorias.includes(category as never);
            const count = (isFiltered ? stats.byCategory : totalStats.byCategory)[category as keyof typeof totalStats.byCategory] ?? 0;
            return (
              <button
                key={category}
                onClick={() => toggleCategory(category)}
                aria-pressed={active}
                className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}
              >
                {category}
                <span className={cn('text-[11px]', active ? 'opacity-80' : 'text-faint')}>{count}</span>
              </button>
            );
          })}
        </div>
        {isFiltered && (
          <p className="text-[11px] text-faint mt-2">
            Los contadores muestran los resultados con los filtros aplicados.
          </p>
        )}

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ok-solid" aria-hidden />
            <strong className="text-body">Calidad</strong>: score compuesto (metadatos + contenido, 0-100)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileSearch className="h-3.5 w-3.5 text-faint shrink-0" />
            <strong className="text-body">Análisis</strong>: auditoría del archivo descargado
          </span>
        </div>
      </div>

      {/* Mobile filter button */}
      <div className="lg:hidden">
        <Button
          variant="secondary"
          className="w-full gap-2"
          onClick={() => setMobileFiltersOpen(true)}
        >
          <Filter className="h-4 w-4" />
          Filtros
          {isFiltered && (
            <span className="ml-1 rounded-full bg-ok-surface px-1.5 py-0.5 text-[10px] font-semibold text-ok">
              {filters.categorias.length + filters.formatos.length + filters.licencias.length + (filters.desde ? 1 : 0) + (filters.hasta ? 1 : 0) + (filters.q ? 1 : 0)}
            </span>
          )}
        </Button>
      </div>

      {/* Mobile filter sheet */}
      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-faint" />
              Filtros
            </SheetTitle>
          </SheetHeader>
          <FilterContent stats={totalStats} onApply={() => setMobileFiltersOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Active Filters */}
      {activeChips.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-faint font-medium">Filtros Activos:</span>
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.onRemove}
              aria-label={`Quitar filtro ${chip.label}`}
              className="group inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-body transition-all hover:border-bad-line hover:bg-bad-surface hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              {chip.key === 'desde' || chip.key === 'hasta' ? (
                <CalendarDays className="h-3.5 w-3.5 text-faint" aria-hidden />
              ) : chip.key === 'q' ? (
                <Search className="h-3.5 w-3.5 text-faint" aria-hidden />
              ) : null}
              {chip.label}
              <X className="h-3.5 w-3.5 text-faint group-hover:text-bad" aria-hidden />
            </button>
          ))}
          <button
            onClick={clearAll}
            className="rounded text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline"
          >
            Limpiar todos
          </button>
        </div>
      )}

      {/* Toolbar: vista + orden + resultados */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="Modo de vista">
            {VIEWS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setVista(id)}
                aria-pressed={vista === id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  vista === id ? 'bg-primary text-primary-fg' : 'text-body hover:bg-fill'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className={id === 'ficheros' ? 'hidden sm:inline' : undefined}>{label}</span>
                {id === 'ficheros' && <span className="sm:hidden">Ficheros</span>}
              </button>
            ))}
          </div>
          {isCards && (
            <p className="hidden text-sm text-faint sm:block">
              <span className="font-semibold text-body">{startIdx}–{endIdx}</span> de{' '}
              <span className="font-semibold text-body">{totalFiltered}</span>
            </p>
          )}
        </div>
        {isCards && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-faint">
              <ArrowUpDown className="h-3.5 w-3.5" />
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
              <select
                value={filters.limit}
                onChange={(e) => navigate({ limit: Number(e.target.value) })}
                className="rounded-lg border border-field bg-card px-2 py-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}/página</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Vista de mapa */}
      {isMap && (
        geoDatasets.length > 0 ? (
          <div>
            <LeafletMapWrapper datasets={geoDatasets} />
            <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-faint">
              <span>{geoDatasets.length} datasets con ubicación conocida (de {totalFiltered} filtrados)</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ok-solid" aria-hidden /> Sin fallos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-bad-solid" aria-hidden /> Con fallos de análisis
              </span>
            </div>
            <p className="text-[11px] text-faint mt-1">
              Ubicaciones orientativas según la cobertura espacial declarada en los metadatos.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MapPin className="h-12 w-12 text-faint mb-4" />
            <h3 className="text-lg font-semibold text-body">Sin datasets ubicables en el mapa</h3>
            <p className="text-sm text-faint mt-1 max-w-md">
              Ningún dataset del resultado actual tiene una cobertura espacial reconocible.
              Prueba el filtro «Solo geoespacial» o cambia a la vista de tarjetas.
            </p>
          </div>
        )
      )}

      {/* Vista de ficheros con problemas */}
      {isFiles && (
        <BrokenFilesView
          rows={brokenRows}
          formatTotals={formatTotals}
          totalDistributions={Object.values(formatTotals).reduce((a, b) => a + b, 0)}
        />
      )}

      {/* Dataset Grid */}
      {isCards && (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {datasets.map((dataset) => (
          <DatasetCard key={dataset.id} dataset={dataset} analysis={analysisBySlug?.[datasetSlug(dataset.id)]} />
        ))}
      </div>
      )}

      {/* Pagination */}
      {isCards && totalPages > 1 && (
        <nav className="flex items-center justify-center gap-1" aria-label="Paginación">
          <Button
            variant="secondary"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => navigate({ page: filters.page - 1 })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {pageNumbers.map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-2 text-faint">…</span>
            ) : (
              <Button
                key={p}
                variant={p === filters.page ? 'default' : 'secondary'}
                size="sm"
                onClick={() => navigate({ page: p })}
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
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
      )}

      {/* Empty State */}
      {isCards && datasets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Database className="h-12 w-12 text-faint mb-4" />
          <h3 className="text-lg font-semibold text-body">No hay datasets</h3>
          <p className="text-sm text-faint mt-1">Ajusta los filtros para ver resultados</p>
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
