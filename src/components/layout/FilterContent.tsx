"use client";

import React, { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, FileText, ScrollText, CalendarDays, Search, RotateCcw, FlaskConical, MapPin } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { CatalogStats, Category, DataFormat, License } from '@/lib/types';
import { categoryIcons } from '@/data/categories';
import {
  buildFilterUrl,
  filtersAreActive,
  LICENSE_DESCRIPTIONS,
  parseActiveFilters,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  type ActiveFilters,
} from '@/lib/catalog-filters';

const emptyFilters: ActiveFilters = {
  categorias: [],
  formatos: [],
  licencias: [],
  desde: undefined,
  hasta: undefined,
  q: undefined,
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  sort: DEFAULT_SORT,
};

interface FilterContentProps {
  stats: CatalogStats;
  onApply?: () => void;
}

export function FilterContent({ stats, onApply }: FilterContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlKey = searchParams.toString();

  const [draft, setDraft] = useState<ActiveFilters>(() =>
    parseActiveFilters(Object.fromEntries(searchParams.entries()))
  );
  const [prevKey, setPrevKey] = useState(urlKey);
  if (prevKey !== urlKey) {
    setPrevKey(urlKey);
    setDraft(parseActiveFilters(Object.fromEntries(searchParams.entries())));
  }

  const selectedCount =
    draft.categorias.length + draft.formatos.length + draft.licencias.length +
    (draft.desde ? 1 : 0) + (draft.hasta ? 1 : 0) + (draft.analisis ? 1 : 0) + (draft.geo ? 1 : 0);

  /**
   * Los grupos arrancan plegados salvo los que ya traen selección: con seis
   * bloques abiertos había que hacer scroll para ver siquiera qué se puede
   * filtrar. Se calcula una sola vez, al montar, para que plegar o desplegar a
   * mano no se revierta al teclear.
   */
  const [openGroups] = useState<string[]>(() => {
    const initial = parseActiveFilters(Object.fromEntries(searchParams.entries()));
    const open: string[] = [];
    if (initial.categorias.length) open.push('categorias');
    if (initial.formatos.length || initial.geo) open.push('formatos');
    if (initial.analisis) open.push('estado');
    if (initial.licencias.length) open.push('licencias');
    if (initial.desde || initial.hasta) open.push('temporal');
    return open.length > 0 ? open : ['categorias'];
  });

  const toggle = (group: keyof Pick<ActiveFilters, 'categorias' | 'formatos' | 'licencias'>, value: string) => {
    setDraft((prev) => {
      const current = prev[group];
      const next = current.includes(value as never)
        ? current.filter((v) => v !== value)
        : [...current, value as never];
      return { ...prev, [group]: next };
    });
  };

  const setQ = (q: string) => setDraft((prev) => ({ ...prev, q: q || undefined }));

  const applyFilters = () => {
    const url = buildFilterUrl(draft);
    if (pathname === '/catalogo') {
      router.replace(url);
    } else {
      router.push(url);
    }
    onApply?.();
  };

  const clearFilters = () => {
    setDraft(emptyFilters);
    router.push('/catalogo');
    onApply?.();
  };

  const categoryOptions = useMemo(
    () => Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]) as [Category, number][],
    [stats]
  );
  const formatOptions = useMemo(
    () => Object.entries(stats.formatsBreakdown).sort((a, b) => b[1] - a[1]) as [DataFormat, number][],
    [stats]
  );
  const licenseOptions = useMemo(
    () => Object.entries(stats.licenseBreakdown).sort((a, b) => b[1] - a[1]) as [License, number][],
    [stats]
  );

  const countBadge = (n: number) =>
    n > 0 ? (
      <span className="ml-1 rounded-full bg-ok-surface px-1.5 py-0.5 text-[10px] font-semibold text-ok">{n}</span>
    ) : null;

  return (
    // Una sola columna que se desplaza entera: el botón de aplicar viaja con
    // el contenido en vez de quedar fijo por encima de la lista.
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-faint" aria-hidden />
        <input
          type="search"
          placeholder="Buscar dataset…"
          value={draft.q ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
          aria-label="Buscar dataset por título, descripción o palabras clave"
          className="h-9 w-full rounded-md border border-field bg-card pl-8 pr-3 text-sm text-body placeholder:text-faint transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        />
      </div>

      {/* Orden: primero por lo que la gente busca (tema, formato), luego por
          estado de los archivos, y al final los cortes minoritarios. */}
      <Accordion type="multiple" defaultValue={openGroups} className="space-y-0.5">
        <AccordionItem value="categorias">
          <AccordionTrigger>
            <LayoutGrid className="h-4 w-4" aria-hidden />
            <span>Temática</span>
            {countBadge(draft.categorias.length)}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              {categoryOptions.map(([name, count]) => {
                const Icon = categoryIcons[name] ?? LayoutGrid;
                return (
                  <label key={name} className="group flex cursor-pointer items-center gap-2 rounded p-1.5 transition-colors hover:bg-fill">
                    <Checkbox
                      checked={draft.categorias.includes(name)}
                      onCheckedChange={() => toggle('categorias', name)}
                    />
                    <Icon className="h-3.5 w-3.5 text-faint" aria-hidden />
                    <span className="flex-1 truncate text-sm text-body">{name}</span>
                    <span className="text-[10px] tabular-nums text-faint">{count}</span>
                  </label>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="formatos">
          <AccordionTrigger>
            <FileText className="h-4 w-4" aria-hidden />
            <span>Formato</span>
            {countBadge(draft.formatos.length + (draft.geo ? 1 : 0))}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              {/* Vivía en los chips de cabecera, que se han retirado. */}
              <label className="flex cursor-pointer items-center gap-2 rounded border-b border-border p-1.5 pb-2.5 transition-colors hover:bg-fill">
                <Checkbox
                  checked={Boolean(draft.geo)}
                  onCheckedChange={() => setDraft((prev) => ({ ...prev, geo: prev.geo ? undefined : true }))}
                />
                <MapPin className="h-3.5 w-3.5 text-faint" aria-hidden />
                <span className="flex-1 truncate text-sm text-body">Solo geoespaciales</span>
              </label>
              {formatOptions.map(([fmt, count]) => (
                <label key={fmt} className="flex cursor-pointer items-center gap-2 rounded p-1.5 transition-colors hover:bg-fill">
                  <Checkbox
                    checked={draft.formatos.includes(fmt)}
                    onCheckedChange={() => toggle('formatos', fmt)}
                  />
                  <span className="flex-1 font-mono text-sm text-body">{fmt}</span>
                  <span className="text-[10px] tabular-nums text-faint">{count}</span>
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="estado">
          <AccordionTrigger>
            <FlaskConical className="h-4 w-4" aria-hidden />
            <span>Estado de los archivos</span>
            {draft.analisis ? countBadge(1) : null}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              {([
                { value: undefined, label: 'Todos' },
                { value: 'ok', label: 'Todos los archivos abren' },
                { value: 'parcial', label: 'Algunos archivos fallan' },
                { value: 'error', label: 'Ningún archivo abre' },
                { value: 'sin-datos', label: 'Sin analizar' },
              ] as const).map(({ value, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, analisis: value }))}
                  aria-pressed={draft.analisis === value}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm transition-colors ${
                    draft.analisis === value ? 'bg-ok-surface text-ok' : 'text-body hover:bg-fill'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    value === 'ok' ? 'bg-ok-solid' :
                    value === 'parcial' ? 'bg-warn-solid' :
                    value === 'error' ? 'bg-bad-solid' :
                    value === 'sin-datos' ? 'bg-faint' :
                    'border border-border bg-transparent'
                  }`} aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="licencias">
          <AccordionTrigger>
            <ScrollText className="h-4 w-4" aria-hidden />
            <span>Licencia</span>
            {countBadge(draft.licencias.length)}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              {licenseOptions.map(([lic, count]) => (
                <label
                  key={lic}
                  title={LICENSE_DESCRIPTIONS[lic] ?? lic}
                  className="flex cursor-pointer items-center gap-2 rounded p-1.5 transition-colors hover:bg-fill"
                >
                  <Checkbox
                    checked={draft.licencias.includes(lic)}
                    onCheckedChange={() => toggle('licencias', lic)}
                  />
                  <span className="flex-1 truncate text-sm text-body">{lic}</span>
                  <span className="text-[10px] tabular-nums text-faint">{count}</span>
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="temporal">
          <AccordionTrigger>
            <CalendarDays className="h-4 w-4" aria-hidden />
            <span>Fecha de publicación</span>
            {(draft.desde || draft.hasta) ? countBadge(1) : null}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3">
              <div>
                <label htmlFor="filtro-desde" className="mb-1 block text-xs text-faint">Desde</label>
                <input
                  id="filtro-desde"
                  type="date"
                  value={draft.desde ?? ''}
                  min={stats.dateRange.min || undefined}
                  max={stats.dateRange.max || undefined}
                  onChange={(e) => setDraft((prev) => ({ ...prev, desde: e.target.value || undefined }))}
                  className="h-8 w-full rounded-md border border-field bg-card px-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                />
              </div>
              <div>
                <label htmlFor="filtro-hasta" className="mb-1 block text-xs text-faint">Hasta</label>
                <input
                  id="filtro-hasta"
                  type="date"
                  value={draft.hasta ?? ''}
                  min={stats.dateRange.min || undefined}
                  max={stats.dateRange.max || undefined}
                  onChange={(e) => setDraft((prev) => ({ ...prev, hasta: e.target.value || undefined }))}
                  className="h-8 w-full rounded-md border border-field bg-card px-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                />
              </div>
              <p className="text-[11px] text-faint">
                El catálogo abarca de {stats.dateRange.min || '—'} a {stats.dateRange.max || '—'}.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="space-y-2 border-t border-border pt-3">
        <Button className="w-full" onClick={applyFilters}>
          Aplicar filtros
          {selectedCount > 0 && (
            // `current` es el color de texto del botón, que ya voltea con el
            // tema; `bg-white/20` desaparecía sobre el verde claro del oscuro.
            <span className="ml-1 rounded-full bg-current/20 px-1.5 py-0.5 text-[10px] font-semibold">{selectedCount}</span>
          )}
        </Button>
        {filtersAreActive(draft) && (
          <button
            onClick={clearFilters}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-faint transition-colors hover:bg-fill hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}
