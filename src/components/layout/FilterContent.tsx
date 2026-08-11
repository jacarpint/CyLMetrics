"use client";

import React, { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, FileText, ScrollText, CalendarDays, Search, RotateCcw, FlaskConical } from 'lucide-react';
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
  sort: 'quality-desc',
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
    (draft.desde ? 1 : 0) + (draft.hasta ? 1 : 0) + (draft.analisis ? 1 : 0);

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

  return (
    <>
      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Buscar dataset..."
            value={draft.q ?? ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            className="w-full h-9 pl-8 pr-3 rounded-md border border-field bg-card text-sm text-body placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <Accordion type="multiple" defaultValue={['categorias', 'formatos', 'licencias', 'temporal']} className="space-y-0.5">
          {/* Categories */}
          <AccordionItem value="categorias">
            <AccordionTrigger>
              <LayoutGrid className="h-4 w-4" />
              <span>Categorías</span>
              {draft.categorias.length > 0 && (
                <span className="ml-1 text-[10px] font-semibold text-ok bg-ok-surface rounded-full px-1.5 py-0.5">
                  {draft.categorias.length}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {categoryOptions.map(([name, count]) => {
                  const Icon = categoryIcons[name] ?? LayoutGrid;
                  return (
                    <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-fill p-1.5 rounded transition-colors group">
                      <Checkbox
                        checked={draft.categorias.includes(name)}
                        onCheckedChange={() => toggle('categorias', name)}
                        className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      />
                      <Icon className="h-3.5 w-3.5 text-faint" />
                      <span className="text-sm text-body flex-1 truncate">{name}</span>
                      <span className="text-[10px] text-faint tabular-nums">{count}</span>
                    </label>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Formats */}
          <AccordionItem value="formatos">
            <AccordionTrigger>
              <FileText className="h-4 w-4" />
              <span>Formatos</span>
              {draft.formatos.length > 0 && (
                <span className="ml-1 text-[10px] font-semibold text-ok bg-ok-surface rounded-full px-1.5 py-0.5">
                  {draft.formatos.length}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {formatOptions.map(([fmt, count]) => (
                  <label key={fmt} className="flex items-center gap-2 cursor-pointer hover:bg-fill p-1.5 rounded transition-colors">
                    <Checkbox
                      checked={draft.formatos.includes(fmt)}
                      onCheckedChange={() => toggle('formatos', fmt)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm text-body font-mono flex-1">{fmt}</span>
                    <span className="text-[10px] text-faint tabular-nums">{count}</span>
                  </label>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Licenses */}
          <AccordionItem value="licencias">
            <AccordionTrigger>
              <ScrollText className="h-4 w-4" />
              <span>Licencias</span>
              {draft.licencias.length > 0 && (
                <span className="ml-1 text-[10px] font-semibold text-ok bg-ok-surface rounded-full px-1.5 py-0.5">
                  {draft.licencias.length}
                </span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {licenseOptions.map(([lic, count]) => (
                  <label
                    key={lic}
                    title={LICENSE_DESCRIPTIONS[lic] ?? lic}
                    className="flex items-center gap-2 cursor-pointer hover:bg-fill p-1.5 rounded transition-colors"
                  >
                    <Checkbox
                      checked={draft.licencias.includes(lic)}
                      onCheckedChange={() => toggle('licencias', lic)}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm text-body flex-1 truncate">{lic}</span>
                    <span className="text-[10px] text-faint tabular-nums">{count}</span>
                  </label>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Temporal Range */}
          <AccordionItem value="temporal">
            <AccordionTrigger>
              <CalendarDays className="h-4 w-4" />
              <span>Rango Temporal</span>
              {(draft.desde || draft.hasta) && (
                <span className="ml-1 text-[10px] font-semibold text-ok bg-ok-surface rounded-full px-1.5 py-0.5">1</span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-faint mb-1 block">Desde (publicación)</label>
                  <input
                    type="date"
                    value={draft.desde ?? ''}
                    min={stats.dateRange.min || undefined}
                    max={stats.dateRange.max || undefined}
                    onChange={(e) => setDraft((prev) => ({ ...prev, desde: e.target.value || undefined }))}
                    className="w-full h-8 rounded-md border border-field bg-card px-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  />
                </div>
                <div>
                  <label className="text-xs text-faint mb-1 block">Hasta (publicación)</label>
                  <input
                    type="date"
                    value={draft.hasta ?? ''}
                    min={stats.dateRange.min || undefined}
                    max={stats.dateRange.max || undefined}
                    onChange={(e) => setDraft((prev) => ({ ...prev, hasta: e.target.value || undefined }))}
                    className="w-full h-8 rounded-md border border-field bg-card px-2 text-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  />
                </div>
                <p className="text-[11px] text-faint">
                  Catálogo publicado entre {stats.dateRange.min || '—'} y {stats.dateRange.max || '—'}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
          {/* Análisis */}
          <AccordionItem value="analisis">
            <AccordionTrigger>
              <FlaskConical className="h-4 w-4" />
              <span>Análisis</span>
              {draft.analisis && (
                <span className="ml-1 text-[10px] font-semibold text-ok bg-ok-surface rounded-full px-1.5 py-0.5">1</span>
              )}
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {([
                  { value: undefined, label: 'Todos' },
                  { value: 'ok', label: 'Sin fallos' },
                  { value: 'parcial', label: 'Con fallos parciales' },
                  { value: 'error', label: 'Con fallos' },
                  { value: 'sin-datos', label: 'Sin análisis' },
                ] as const).map(({ value, label }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, analisis: value }))}
                    className={`w-full text-left flex items-center gap-2 px-1.5 py-1.5 rounded text-sm transition-colors ${
                      draft.analisis === value
                        ? 'text-ok bg-ok-surface'
                        : 'text-body hover:bg-fill'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                      value === 'ok' ? 'bg-ok-solid' :
                      value === 'parcial' ? 'bg-warn-solid' :
                      value === 'error' ? 'bg-bad-solid' :
                      value === 'sin-datos' ? 'bg-faint' :
                      'bg-transparent border border-border'
                    }`} />
                    {label}
                  </button>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <Button className="w-full" size="lg" onClick={applyFilters}>
          Aplicar Filtros
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
    </>
  );
}
