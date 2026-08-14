"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  BarChart3,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { issueExplanation } from "@/lib/quality-labels";
import { presentationForFormat, type IssuePresentation } from "@/lib/unit-words";
import type { IssueInfo, IssueSeverity } from "@/lib/quality-report";
import type { AffectedColumn, IssuePosition } from "@/lib/report-bundle";

/** Posiciones que se piden de una vez. */
const PAGE = 50;
/** Columnas afectadas que se listan antes de plegar el resto. */
const VISIBLE_COLUMNS = 8;

function isEmptyValue(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === "" || v === "None";
}

function EmptyMark() {
  return <span className="italic text-faint">(vacío)</span>;
}

/* ------------------------------------------------------------------ */
/* Dónde está el problema                                              */
/* ------------------------------------------------------------------ */

const UNIT_LABEL: Record<IssuePresentation, { position: string; group: string }> = {
  table: { position: "Fila", group: "Columna" },
  record: { position: "Registro", group: "Campo" },
  plain: { position: "Posición", group: "Elemento" },
};

/**
 * Columnas afectadas, de más a menos.
 *
 * Es lo primero que se enseña porque es lo que sirve para arreglar: «FECHA_ALTA
 * concentra 12.400 de los 12.600 casos» dice dónde mirar, y una lista de 12.400
 * posiciones no dice nada. Las posiciones vienen después, para quien necesite
 * ir a la fila concreta.
 */
function AffectedColumns({
  columns,
  presentation,
}: {
  columns: AffectedColumn[];
  presentation: IssuePresentation;
}) {
  const [showAll, setShowAll] = useState(false);
  if (columns.length === 0) return null;

  const visible = showAll ? columns : columns.slice(0, VISIBLE_COLUMNS);
  const hidden = columns.length - visible.length;
  const max = columns[0]?.count ?? 1;
  const noun = UNIT_LABEL[presentation].group.toLowerCase();

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="eyebrow mb-2">
        {columns.length === 1 ? `${UNIT_LABEL[presentation].group} afectada` : `${UNIT_LABEL[presentation].group}s afectadas`}
      </p>
      <ul className="space-y-1.5">
        {visible.map((column) => (
          <li key={`${column.sheet ?? ""}|${column.col}`} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-body" title={column.field ?? undefined}>
              {column.sheet && <span className="text-faint">{column.sheet} · </span>}
              {column.field || `${noun} ${column.col + 1}`}
            </span>
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-fill" aria-hidden>
              <span
                className="block h-full rounded-full bg-faint"
                style={{ width: `${Math.max(Math.round((column.count / max) * 100), 3)}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-body">
              {column.count.toLocaleString("es-ES")}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 rounded text-xs text-faint underline-offset-2 hover:text-body hover:underline"
        >
          … mostrar {hidden} más
        </button>
      )}
    </div>
  );
}

/** Tabla de posiciones concretas, paginada contra el fragmento del informe. */
function Positions({
  positions,
  presentation,
  showValue,
}: {
  positions: IssuePosition[];
  presentation: IssuePresentation;
  showValue: boolean;
}) {
  const labels = UNIT_LABEL[presentation];
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">Posiciones afectadas por esta incidencia</caption>
        <thead>
          <tr>
            <th scope="col" className="w-20 border-b border-border bg-fill px-2 py-1.5 text-left font-semibold text-faint">
              {labels.position}
            </th>
            <th scope="col" className="border-b border-border bg-fill px-2 py-1.5 text-left font-semibold text-faint">
              {labels.group}
            </th>
            {showValue && (
              <th scope="col" className="border-b border-border bg-fill px-2 py-1.5 text-left font-semibold text-faint">
                Valor
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {positions.map((position, i) => (
            <tr key={`${position.row}-${position.col}-${i}`} className="border-b border-border last:border-0">
              <th scope="row" className="bg-fill px-2 py-1.5 text-center font-mono font-normal text-faint">
                {position.row?.toLocaleString("es-ES") ?? "—"}
              </th>
              <td className="max-w-[220px] truncate px-2 py-1.5 font-mono text-body" title={position.field ?? undefined}>
                {position.sheet && <span className="text-faint">{position.sheet} · </span>}
                {position.field ?? (position.col == null ? "—" : `${labels.group} ${position.col + 1}`)}
              </td>
              {showValue && (
                <td className="max-w-[260px] truncate px-2 py-1.5 font-mono text-bad" title={position.cell ?? undefined}>
                  {isEmptyValue(position.cell) ? <EmptyMark /> : position.cell}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carga perezosa de posiciones                                        */
/* ------------------------------------------------------------------ */

interface PositionsState {
  items: IssuePosition[];
  total: number;
  loading: boolean;
  error: string | null;
}

/**
 * Pide una página de posiciones. Función suelta y sin estado a propósito: así
 * el efecto de arranque y el botón de «cargar más» comparten la petición pero
 * cada uno decide qué hacer con el resultado.
 */
async function fetchPositions(
  distId: string,
  code: string,
  offset: number,
  signal?: AbortSignal
): Promise<{ positions: IssuePosition[]; total: number }> {
  const params = new URLSearchParams({ dist: distId, code, offset: String(offset), limit: String(PAGE) });
  const res = await fetch(`/api/quality/issues?${params}`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as { positions: IssuePosition[]; total: number };
}

/**
 * Panel de detalle de una incidencia.
 *
 * Las posiciones se piden al abrir, no al renderizar la lista: una distribución
 * puede traer cientos de miles y bajarlas todas para enseñar cincuenta es lo
 * que hacía inservible el visor en los ficheros grandes.
 */
function IssueDetailPanel({
  distId,
  code,
  stored,
  count,
  presentation,
  columns,
}: {
  distId: string | undefined;
  code: string;
  stored: number;
  count: number;
  presentation: IssuePresentation;
  columns?: AffectedColumn[];
}) {
  // Arranca ya en «cargando» cuando hay algo que pedir: así el efecto de abajo
  // no tiene que ponerlo, que es lo que encadenaba un render de más nada más
  // desplegar la incidencia.
  const [state, setState] = useState<PositionsState>({
    items: [],
    total: stored,
    loading: stored > 0 && Boolean(distId),
    error: null,
  });

  const loadMore = useCallback(async () => {
    if (!distId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchPositions(distId, code, state.items.length);
      setState((s) => ({
        items: [...s.items, ...data.positions],
        total: data.total,
        loading: false,
        error: null,
      }));
    } catch {
      setState((s) => ({ ...s, loading: false, error: "No se pudieron cargar las posiciones." }));
    }
  }, [distId, code, state.items.length]);

  // Primera página al desplegar la incidencia. La petición se aborta si el
  // panel se cierra antes de que llegue.
  useEffect(() => {
    if (stored === 0 || !distId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchPositions(distId, code, 0, controller.signal);
        setState({ items: data.positions, total: data.total, loading: false, error: null });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setState((s) => ({ ...s, loading: false, error: "No se pudieron cargar las posiciones." }));
      }
    })();
    return () => controller.abort();
  }, [stored, distId, code]);

  if (stored === 0) {
    return (
      <p className="text-xs text-body">
        Esta incidencia afecta al archivo entero, así que no hay una posición concreta que señalar dentro de él.
      </p>
    );
  }

  if (!distId) {
    return (
      <p className="text-xs text-body">
        Las posiciones concretas están en la ficha de este archivo.
      </p>
    );
  }

  // Solo tiene sentido enseñar la columna «Valor» si alguna posición la trae:
  // en «celda vacía» el valor es vacío por definición y la columna sobra.
  const showValue = state.items.some((p) => p.cell !== undefined);
  const remaining = state.total - state.items.length;

  return (
    <div className="space-y-2">
      {stored < count && (
        <p className="rounded-md border border-warn-line bg-warn-surface px-3 py-2 text-xs text-warn">
          Se registraron {count.toLocaleString("es-ES")} casos y se guardaron las posiciones de los{" "}
          {stored.toLocaleString("es-ES")} primeros.
        </p>
      )}
      {columns && columns.length > 0 && <AffectedColumns columns={columns} presentation={presentation} />}
      {state.items.length > 0 && (
        <div className="rounded-md border border-border bg-card p-3">
          <p className="eyebrow mb-2">
            Posiciones · mostrando {state.items.length.toLocaleString("es-ES")} de{" "}
            {state.total.toLocaleString("es-ES")}
          </p>
          <Positions positions={state.items} presentation={presentation} showValue={showValue} />
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={state.loading}
              className="mt-2 inline-flex items-center gap-1.5 rounded text-xs text-faint underline-offset-2 hover:text-body hover:underline disabled:opacity-60"
            >
              {state.loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Cargar {Math.min(remaining, PAGE).toLocaleString("es-ES")} más
            </button>
          )}
        </div>
      )}
      {state.loading && state.items.length === 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-faint">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Cargando posiciones…
        </p>
      )}
      {state.error && <p className="text-xs text-bad">{state.error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Explorador                                                          */
/* ------------------------------------------------------------------ */

/**
 * Incidencia con el formato del recurso del que salió. La ficha de dataset
 * agrega incidencias de varias distribuciones a la vez (un CSV y un JSON del
 * mismo dataset), así que la presentación se decide por incidencia y no por
 * pantalla — y por eso cada una lleva también el fragmento donde están sus
 * posiciones.
 */
export type IssueWithFormat = IssueInfo & {
  format?: string;
  /** Fragmento del informe con las posiciones (sha1 de la URL del recurso). */
  distId?: string;
  /** Columnas afectadas, resueltas en el servidor al leer el fragmento. */
  columns?: AffectedColumn[];
};

interface IssueExplorerProps {
  issues: IssueWithFormat[];
  totalCells?: number;
  /** Formato por defecto cuando la incidencia no trae el suyo. */
  format?: string;
  className?: string;
}

/**
 * Une incidencias del mismo código y formato sumando sus recuentos. Sin esto,
 * agregar varias distribuciones producía entradas repetidas que además
 * compartían clave de React y se desplegaban a la vez.
 */
function mergeIssues(issues: IssueWithFormat[]): (IssueWithFormat & { key: string })[] {
  const merged = new Map<string, IssueWithFormat & { key: string }>();
  for (const issue of issues) {
    // El fragmento entra en la clave: dos CSV del mismo dataset con la misma
    // incidencia son dos archivos distintos, y fundirlos dejaba las posiciones
    // de uno colgando del recuento de los dos.
    const key = `${issue.code}|${issue.format ?? ""}|${issue.distId ?? ""}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...issue, key });
      continue;
    }
    existing.count += issue.count;
    existing.stored += issue.stored;
    if (issue.severity === "error") existing.severity = "error";
  }
  return [...merged.values()];
}

/**
 * Cómo se presenta cada severidad.
 *
 * `info` tiene tono y rótulo propios porque no es un defecto del archivo: son las
 * incidencias que hablan del portal —falta el lector, se rompió nuestro código—.
 * Pintarlas de amarillo y rotularlas «Aviso», que es lo que salía al tratar todo
 * lo que no era error como advertencia, seguía señalando al publicador.
 */
const SEVERITY_STYLE: Record<IssueSeverity, {
  fill: string; box: string; text: string; label: string; icon: typeof XCircle;
}> = {
  error: {
    fill: "bg-bad-solid", box: "border-bad-line bg-bad-surface",
    text: "text-bad", label: "Error", icon: XCircle,
  },
  warning: {
    fill: "bg-warn-solid", box: "border-warn-line bg-warn-surface",
    text: "text-warn", label: "Aviso", icon: AlertTriangle,
  },
  info: {
    fill: "bg-info", box: "border-info-line bg-info-surface",
    text: "text-info", label: "Sin analizar", icon: Info,
  },
};

function ImpactBar({ count, max, severity }: { count: number; max: number; severity: IssueSeverity }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-fill" aria-hidden>
      <div
        className={cn("h-full rounded-full transition-all duration-500", SEVERITY_STYLE[severity].fill)}
        style={{ width: `${Math.max(pct, 3)}%` }}
      />
    </div>
  );
}

export function IssueExplorer({ issues, totalCells, format, className }: IssueExplorerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (issues.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-ok-line bg-ok-surface px-3 py-2.5 text-sm text-ok", className)}>
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        Estructura y tipos sin incidencias
      </div>
    );
  }

  const items = mergeIssues(issues);
  const maxCount = Math.max(...items.map((i) => i.count));
  const errorCount = items.filter((i) => i.severity === "error").reduce((s, i) => s + i.count, 0);
  const warningCount = items.filter((i) => i.severity === "warning").reduce((s, i) => s + i.count, 0);
  // Las `info` se cuentan aparte y no con las advertencias: no son defectos del
  // archivo. Sin este recuento quedaban listadas abajo pero sin aparecer en el
  // resumen, así que el titular podía decir «0 errores, 0 advertencias» con una
  // tarjeta debajo.
  const notAnalyzedCount = items.filter((i) => i.severity === "info").length;
  // Ordenar por severidad y luego por volumen. Solo por volumen, "celdas
  // vacías" (el 82% del recuento del catálogo) sepultaba siempre a los errores
  // que de verdad impiden usar el fichero. Las `info` van al final: son lo único
  // que no pide ninguna corrección al publicador.
  const SORT_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...items].sort(
    (a, b) => SORT_RANK[a.severity] - SORT_RANK[b.severity] || b.count - a.count
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Resumen. Los dos recuentos van separados a propósito: sumarlos daba
          un número dominado por las celdas vacías, que son el 82% del volumen
          pero casi nunca lo que impide reutilizar el dato. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-body">
          <BarChart3 className="h-3.5 w-3.5 text-faint" aria-hidden />
          <strong>{items.length}</strong> tipo{items.length !== 1 && "s"} de incidencia
        </span>
        {errorCount > 0 && (
          <span className="inline-flex items-center gap-1 text-bad">
            <XCircle className="h-3 w-3" aria-hidden />
            <strong>{errorCount.toLocaleString("es-ES")}</strong> errores
            {totalCells != null && totalCells > 0 && (
              <span className="font-normal text-faint">
                ({((errorCount / totalCells) * 100).toFixed(1)}% de celdas)
              </span>
            )}
          </span>
        )}
        {warningCount > 0 && (
          <span className="inline-flex items-center gap-1 text-warn">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            <strong>{warningCount.toLocaleString("es-ES")}</strong> advertencias
            {totalCells != null && totalCells > 0 && (
              <span className="font-normal text-faint">
                ({((warningCount / totalCells) * 100).toFixed(1)}% de celdas)
              </span>
            )}
          </span>
        )}
        {/* Sin porcentaje de celdas: no se ha llegado a leer ninguna. */}
        {notAnalyzedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-info">
            <Info className="h-3 w-3" aria-hidden />
            {notAnalyzedCount === 1 ? 'una comprobación sin hacer' : `${notAnalyzedCount} comprobaciones sin hacer`}
          </span>
        )}
      </div>

      {/* Incidencias */}
      <div className="space-y-2">
        {sorted.map((issue) => {
          const isExpanded = expanded === issue.key;
          const explanation = issueExplanation(issue.code);
          const style = SEVERITY_STYLE[issue.severity];
          const SeverityIcon = style.icon;
          const panelId = `incidencia-${issue.key.replace(/\W+/g, "-")}`;
          const presentation = presentationForFormat(issue.format ?? format);

          return (
            <div key={issue.key} className={cn("rounded-lg border transition-colors", style.box)}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : issue.key)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left"
              >
                <SeverityIcon className={cn("h-4 w-4 shrink-0", style.text)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-strong">{issue.label}</span>
                    {issue.format && (
                      <span className="shrink-0 rounded border border-border bg-card px-1.5 py-px font-mono text-[11px] text-faint">
                        {issue.format}
                      </span>
                    )}
                    <span className={cn("shrink-0 text-[11px] font-semibold uppercase tracking-wide", style.text)}>
                      {style.label}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ImpactBar count={issue.count} max={maxCount} severity={issue.severity} />
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-2">
                  <span className={cn("text-sm font-bold tabular-nums", style.text)}>
                    {issue.count.toLocaleString("es-ES")}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-faint" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-faint" aria-hidden />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div id={panelId} className="space-y-2 px-4 pb-4 pt-0">
                  {explanation && (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                      <p className="text-xs leading-relaxed text-body">{explanation}</p>
                    </div>
                  )}
                  <IssueDetailPanel
                    distId={issue.distId}
                    code={issue.code}
                    stored={issue.stored}
                    count={issue.count}
                    presentation={presentation}
                    columns={issue.columns}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
