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
  const isCatalogo = pathname === '/catalogo' || pathname.startsWith('/catalogo/');

  if (!isCatalogo) return null;

  return (
    <aside className="hidden h-[calc(100vh-4.5rem)] w-64 flex-col border-r border-border bg-card lg:flex sticky top-[4.5rem]">
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="h-4 w-4 text-faint" />
          <h2 className="text-sm font-semibold text-strong">Filtros</h2>
        </div>
        <p className="text-xs text-faint">Datos reales del catálogo de datosabiertos.jcyl.es</p>
      </div>
      <FilterContent stats={stats} />
    </aside>
  );
}
