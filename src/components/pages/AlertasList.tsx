"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, XCircle, ExternalLink, Search, WifiOff, FileWarning, SearchCode } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { datasetSlug } from "@/lib/utils";
import { categoryLabel, type IssueCategory } from "@/lib/quality-labels";
import type { DatasetAlert, AlertLevel } from "@/lib/alerts";

const LEVEL_META: Record<
  AlertLevel,
  { label: string; badge: "destructive" | "warning"; border: string; dot: string; icon: typeof XCircle }
> = {
  critical: {
    label: "Crítico",
    badge: "destructive",
    border: "border-bad-line",
    dot: "bg-bad-solid",
    icon: XCircle,
  },
  warning: {
    label: "Advertencia",
    badge: "warning",
    border: "border-warn-line",
    dot: "bg-warn-solid",
    icon: AlertTriangle,
  },
};

const CATEGORY_META: Record<IssueCategory, { icon: typeof WifiOff; color: string; bg: string }> = {
  availability: { icon: WifiOff, color: "text-bad", bg: "bg-bad-surface" },
  format: { icon: FileWarning, color: "text-warn", bg: "bg-warn-surface" },
  content: { icon: SearchCode, color: "text-info", bg: "bg-info-surface" },
};

type LevelFilter = "all" | AlertLevel;
type CategoryFilter = "all" | IssueCategory;

interface AlertasListProps {
  alerts: DatasetAlert[];
}

/**
 * Alertas que se pintan de golpe por grupo. Con 555 datasets en alerta,
 * renderizarlas todas dejaba la página en más de 2 MB de HTML para una lista
 * que nadie recorre entera: se ojean las primeras y se filtra.
 */
const VISIBLE_STEP = 25;

export function AlertasList({ alerts }: AlertasListProps) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(VISIBLE_STEP);

  const counts = useMemo(
    () => ({
      all: alerts.length,
      critical: alerts.filter((a) => a.level === "critical").length,
      warning: alerts.filter((a) => a.level === "warning").length,
    }),
    [alerts]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return alerts.filter((a) => {
      if (level !== "all" && a.level !== level) return false;
      if (category !== "all" && !a.causes.some((c) => c.category === category)) return false;
      if (needle && !a.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [alerts, level, category, query]);

  const critical = filtered.filter((a) => a.level === "critical");
  const warning = filtered.filter((a) => a.level === "warning");
  // Los críticos se agotan antes de empezar a mostrar advertencias.
  const criticalShown = critical.slice(0, visible);
  const warningShown = warning.slice(0, Math.max(0, visible - critical.length));
  const remaining = filtered.length - criticalShown.length - warningShown.length;

  return (
    <div className="space-y-5">
      {/* Controles */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5">
          <Search className="h-4 w-4 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisible(VISIBLE_STEP); }}
            placeholder="Buscar por título del dataset..."
            aria-label="Buscar alertas por título"
            className="w-full bg-transparent py-1.5 text-sm text-body placeholder:text-faint focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            {([
              ['all', `Todos (${counts.all})`],
              ['critical', `Críticos (${counts.critical})`],
              ['warning', `Advertencias (${counts.warning})`],
            ] as [LevelFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                onClick={() => { setLevel(value); setVisible(VISIBLE_STEP); }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  level === value
                    ? "bg-primary text-primary-fg"
                    : "text-body hover:bg-fill"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            <button
              onClick={() => { setCategory("all"); setVisible(VISIBLE_STEP); }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                category === "all"
                  ? "bg-strong text-canvas"
                  : "text-body hover:bg-fill"
              )}
            >
              Todas
            </button>
            {(['availability', 'format', 'content'] as IssueCategory[]).map((c) => (
              <button
                key={c}
                onClick={() => { setCategory(category === c ? "all" : c); setVisible(VISIBLE_STEP); }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  category === c
                    ? "bg-strong text-canvas"
                    : "text-body hover:bg-fill"
                )}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {critical.length === 0 && warning.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-faint">
              No hay alertas que coincidan con los filtros seleccionados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {criticalShown.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-bad flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Críticos ({critical.length}) — recurso inutilizable
              </h2>
              <div className="space-y-3">
                {criticalShown.map((alert) => (
                  <AlertCard key={alert.datasetId} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {warningShown.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-warn flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                Advertencias ({warning.length}) — problemas de contenido
              </h2>
              <div className="space-y-3">
                {warningShown.map((alert) => (
                  <AlertCard key={alert.datasetId} alert={alert} />
                ))}
              </div>
            </div>
          )}

          {remaining > 0 && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setVisible((n) => n + VISIBLE_STEP * 3)}
                className="rounded-lg border border-field bg-card px-4 py-2 text-xs font-medium text-body transition-colors hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Mostrar más ({remaining.toLocaleString("es-ES")} restantes)
              </button>
              <p className="mt-2 text-[11px] text-faint">
                Usa el buscador y los filtros para acotar en lugar de recorrer la lista entera.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertCard({ alert }: { alert: DatasetAlert }) {
  const meta = LEVEL_META[alert.level];
  const LevelIcon = meta.icon;

  return (
    <Card className={meta.border}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <LevelIcon className={cn("h-4 w-4 shrink-0", alert.level === "critical" ? "text-bad" : "text-warn")} />
              <Link
                href={`/catalogo/${datasetSlug(alert.datasetId)}`}
                className="truncate text-sm font-semibold text-strong hover:text-link"
              >
                {alert.title}
              </Link>
              <Badge variant={meta.badge} className="shrink-0">
                {alert.score != null ? `${alert.score}%` : "Sin análisis"}
              </Badge>
            </div>

            {alert.failedDistributions > 0 && (
              <p className="text-[11px] text-faint mt-1">
                {alert.failedDistributions} de {alert.totalDistributions} distribuciones con fallos
              </p>
            )}

            <ul className="mt-2 space-y-1.5">
              {alert.causes.map((cause) => {
                const cat = CATEGORY_META[cause.category];
                const CatIcon = cat.icon;
                return (
                  <li key={cause.code} className="text-xs text-body flex items-start gap-2">
                    <span className={cn("flex items-center justify-center w-5 h-5 rounded shrink-0 mt-px", cat.bg)}>
                      <CatIcon className={cn("h-3 w-3", cat.color)} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-faint mr-1.5">{categoryLabel(cause.category)}:</span>
                      {cause.label}
                      <span className="font-semibold text-faint ml-1.5">×{cause.count.toLocaleString("es-ES")}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {alert.datasetId.startsWith('http') && (
            <a
              href={alert.datasetId}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 shrink-0 text-faint hover:text-link"
              title="Ver en datosabiertos.jcyl.es"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
