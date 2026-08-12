"use client";

import React from 'react';
import { usePathname } from 'next/navigation';
import { Filter } from 'lucide-react';
import type { CatalogStats } from '@/lib/types';
import { FilterContent } from '@/components/layout/FilterContent';

interface SidebarProps {
  stats: CatalogStats;
}

export function Sidebar({ stats }: SidebarProps) {
  const pathname = usePathname();
  // Solo en el listado. En la ficha de un dataset o de una distribución los
  // filtros no acotan nada de lo que se está leyendo: aplicar uno te sacaba de
  // la página, así que el panel prometía algo que no hacía.
  const isListado = pathname === '/catalogo';

  if (!isListado) return null;

  return (
    // El panel entero se desplaza como una columna: antes la lista scrolleaba
    // dentro de una altura fija y el botón de aplicar quedaba anclado encima.
    <aside className="sticky top-[4.5rem] hidden max-h-[calc(100vh-4.5rem)] w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
          <Filter className="h-4 w-4 text-faint" aria-hidden />
          Filtros
        </h2>
      </div>
      <FilterContent stats={stats} />
    </aside>
  );
}
