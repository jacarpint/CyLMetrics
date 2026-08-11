"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IssueInfo, IssueSample } from "@/lib/quality-report";

const ISSUE_DESCRIPTIONS: Record<string, string> = {
  "celda-faltante":
    "Celdas vacías en filas que contienen datos en otras columnas. Puede indicar datos incompletos o campos opcionales.",
  "error-tipo":
    "Valores que no coinciden con el tipo mayoritario de su columna (ej: texto en una columna numérica).",
  "encabezado-vacio":
    "Columnas sin nombre en la primera fila. Dificulta el procesamiento automatizado.",
  "fila-vacia":
    "Filas completamente vacías entre los datos. Suelen ser artefactos de exportación.",
  "celda-extra":
    "Filas con más columnas que el encabezado. Puede causar errores en parsers.",
  "encabezado-duplicado":
    "Dos o más columnas con el mismo nombre. Conflictos al indexar o hacer joins.",
  "zip-invalido":
    "El archivo descargado no es un ZIP válido o está corrupto. El recurso es inutilizable.",
  "json-invalido":
    "El contenido no es JSON válido. Verifique la URL o el formato declarado.",
  "xlsx-invalido":
    "El archivo XLSX no puede abrirse. Puede estar corrupto o no ser un XLSX real.",
  "formato-no-esperado":
    "El contenido no coincide con el formato declarado en el catálogo (ej: HTML en una URL de CSV).",
  "xml-no-bien-formado":
    "El XML tiene errores de formato. Puede contener caracteres especiales o etiquetas mal cerradas.",
  "archivo-vacio":
    "El archivo descargado tiene 0 bytes. El recurso no contiene datos.",
  "error-encoding":
    "Problemas con la codificación de caracteres. Los textos pueden contener caracteres ilegibles.",
  "no-es-archivo":
    "La URL no devuelve un archivo descargable (puede devolver una página HTML).",
  "error-fuente":
    "Error al acceder a la fuente de datos. Problema del servidor remoto.",
  "xml-reparado":
    "El XML tenía problemas que fueron corregidos automáticamente por el analizador.",
  "descarga":
    "Error durante la descarga del archivo (timeout, 404, acceso denegado).",
  "fallo-analizador":
    "Error interno del analizador. No se pudo completar la auditoría.",
};

/* ------------------------------------------------------------------ */
/* Cómo se enseñan las muestras según el formato                       */
/* ------------------------------------------------------------------ */

/**
 * La cuadrícula de filas y columnas solo describe bien a los formatos
 * tabulares. En JSON la unidad es el registro, y en XML/KML/SHP no hay ni
 * filas ni registros planos, así que forzar una tabla inventa una estructura
 * que el recurso no tiene.
 */
export type IssuePresentation = "table" | "record" | "plain";

export function presentationForFormat(format?: string): IssuePresentation {
  switch ((format ?? "").toUpperCase()) {
    case "CSV":
    case "TSV":
    case "XLSX":
    case "XLS":
    case "TXT":
      return "table";
    case "JSON":
    case "GEOJSON":
      return "record";
    default:
      return "plain";
  }
}

/** Índice de la columna afectada dentro de la muestra, o -1. */
function affectedIndex(sample: IssueSample, header?: (string | null)[]): number {
  if (sample.field && header?.length) {
    const idx = header.findIndex((h) => h === sample.field);
    if (idx >= 0) return idx;
  }
  if (sample.field_index != null) return sample.field_index - 1;
  return -1;
}

function isEmptyValue(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === "" || v === "None";
}

function EmptyMark() {
  return <span className="italic text-faint">(vacío)</span>;
}

/* ── 1. Tabular: CSV, XLSX… ── */

function SampleTable({ samples }: { samples: IssueSample[] }) {
  const header = samples.find((s) => s.header && s.header.length > 0)?.header;
  if (!header || header.length === 0) return <SamplePlain samples={samples} />;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">Filas de ejemplo afectadas por esta incidencia</caption>
        <thead>
          <tr>
            <th scope="col" className="w-14 border-b border-border bg-fill px-2 py-1.5 text-left font-semibold text-faint">
              Fila
            </th>
            {header.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="max-w-[140px] truncate border-b border-border bg-fill px-2 py-1.5 text-left font-semibold text-faint"
                title={h ?? undefined}
              >
                {h ?? `(col ${i + 1})`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {samples.map((sample, i) => {
            const values = sample.row_values ?? [];
            // Cada muestra resalta SU columna: usar la de la primera señalaba
            // la celda equivocada cuando la incidencia afecta a varias.
            const fieldIdx = affectedIndex(sample, header);
            return (
              <tr key={i} className="border-b border-border last:border-0">
                <th scope="row" className="bg-fill px-2 py-1.5 text-center font-mono font-normal text-faint">
                  {sample.row ?? "—"}
                </th>
                {header.map((_, colIdx) => {
                  const val = colIdx < values.length ? values[colIdx] : null;
                  const highlighted = fieldIdx === colIdx;
                  const empty = isEmptyValue(val);
                  return (
                    <td
                      key={colIdx}
                      className={cn(
                        "max-w-[160px] truncate px-2 py-1.5 font-mono",
                        highlighted
                          ? "bg-bad-surface font-semibold text-bad"
                          : empty
                          ? "text-faint"
                          : "text-body"
                      )}
                      title={val ?? undefined}
                    >
                      {empty ? <EmptyMark /> : val}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── 2. Registro: JSON ── */

const RECORD_CONTEXT_KEYS = 6;

function JsonRecord({ sample }: { sample: IssueSample }) {
  const [showAll, setShowAll] = useState(false);
  const header = sample.header ?? [];
  const values = sample.row_values ?? [];
  const fieldIdx = affectedIndex(sample, header);

  const entries = header.map((key, i) => ({
    key: key ?? `campo_${i + 1}`,
    value: i < values.length ? values[i] : null,
    offending: i === fieldIdx,
  }));

  // Se muestran las primeras claves como contexto, más la que falla siempre.
  const visible = showAll
    ? entries
    : entries.filter((e, i) => i < RECORD_CONTEXT_KEYS || e.offending);
  const hidden = entries.length - visible.length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-fill px-3 py-1.5">
        {sample.row != null && (
          <span className="font-mono text-[10px] text-faint">Registro nº {sample.row.toLocaleString("es-ES")}</span>
        )}
        {sample.field && (
          <span className="text-[10px] text-faint">
            clave <strong className="font-mono font-semibold text-bad">{sample.field}</strong>
          </span>
        )}
      </div>
      <div className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed">
        <div className="text-faint">{"{"}</div>
        <div className="pl-4">
          {visible.map((e, i) => (
            <div
              key={`${e.key}-${i}`}
              className={cn("-mx-1 flex gap-1 rounded px-1", e.offending && "bg-bad-surface")}
            >
              <span className={cn("shrink-0", e.offending ? "font-semibold text-bad" : "font-medium text-strong")}>
                &quot;{e.key}&quot;
              </span>
              <span className="text-faint">:</span>
              <span className={cn("min-w-0 break-all", e.offending ? "font-semibold text-bad" : "text-body")}>
                {isEmptyValue(e.value) ? <EmptyMark /> : <>&quot;{e.value}&quot;</>}
              </span>
              {e.offending && (
                <span className="ml-auto shrink-0 pl-3 text-[10px] font-normal text-bad">← incidencia</span>
              )}
            </div>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-0.5 rounded text-faint underline-offset-2 hover:text-body hover:underline"
            >
              … mostrar {hidden} clave{hidden === 1 ? "" : "s"} restante{hidden === 1 ? "" : "s"}
            </button>
          )}
          {showAll && entries.length > RECORD_CONTEXT_KEYS && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-0.5 rounded text-faint underline-offset-2 hover:text-body hover:underline"
            >
              … plegar
            </button>
          )}
        </div>
        <div className="text-faint">{"}"}</div>
      </div>
    </div>
  );
}

function SampleRecords({ samples }: { samples: IssueSample[] }) {
  const usable = samples.filter((s) => (s.header?.length ?? 0) > 0);
  if (usable.length === 0) return <SamplePlain samples={samples} />;
  return (
    <div className="space-y-2">
      {usable.map((sample, i) => (
        <JsonRecord key={i} sample={sample} />
      ))}
    </div>
  );
}

/* ── 3. Plano: XML, RDF, KML, SHP, ZIP… ── */

function SamplePlain({ samples }: { samples: IssueSample[] }) {
  const withInfo = samples.filter((s) => s.row != null || s.field || s.cell != null);
  if (withInfo.length === 0) {
    return (
      <p className="text-xs text-body">
        El analizador no registró ubicaciones concretas para esta incidencia.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {withInfo.map((sample, i) => (
        <li key={i} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sample.row != null && (
              <span className="rounded bg-fill px-1.5 py-0.5 font-mono text-[10px] text-faint">
                Posición {sample.row.toLocaleString("es-ES")}
              </span>
            )}
            {sample.field && (
              <span className="text-faint">
                Elemento <strong className="font-mono text-body">{sample.field}</strong>
              </span>
            )}
          </div>
          {sample.cell != null && (
            <p className="mt-1 break-all font-mono text-[11px] text-bad">{sample.cell}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Explorador                                                          */
/* ------------------------------------------------------------------ */

/**
 * Incidencia con el formato del recurso del que salió. La ficha de dataset
 * agrega incidencias de varias distribuciones a la vez (un CSV y un JSON del
 * mismo dataset), así que la presentación se decide por incidencia y no por
 * pantalla.
 */
export type IssueWithFormat = IssueInfo & { format?: string };

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
    const key = `${issue.code}|${issue.format ?? ""}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...issue, key, samples: issue.samples ? [...issue.samples] : undefined });
      continue;
    }
    existing.count += issue.count;
    if (issue.severity === "error") existing.severity = "error";
    if (issue.samples?.length && (existing.samples?.length ?? 0) < 5) {
      existing.samples = [...(existing.samples ?? []), ...issue.samples].slice(0, 5);
    }
  }
  return [...merged.values()];
}

function ImpactBar({ count, max, severity }: { count: number; max: number; severity: "error" | "warning" }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-fill" aria-hidden>
      <div
        className={cn("h-full rounded-full transition-all duration-500", severity === "error" ? "bg-bad-solid" : "bg-warn-solid")}
        style={{ width: `${Math.max(pct, 3)}%` }}
      />
    </div>
  );
}

const SAMPLES_LABEL: Record<IssuePresentation, string> = {
  table: "Filas de ejemplo afectadas",
  record: "Registros de ejemplo afectados",
  plain: "Ubicaciones de ejemplo",
};

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
  // Ordenar por severidad y luego por volumen. Solo por volumen, "celdas
  // vacías" (el 82% del recuento del catálogo) sepultaba siempre a los errores
  // que de verdad impiden usar el fichero.
  const sorted = [...items].sort(
    (a, b) =>
      Number(b.severity === "error") - Number(a.severity === "error") || b.count - a.count
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
      </div>

      {/* Incidencias */}
      <div className="space-y-2">
        {sorted.map((issue) => {
          const isExpanded = expanded === issue.key;
          const description = ISSUE_DESCRIPTIONS[issue.code];
          const samples = issue.samples ?? [];
          const hasSamples = samples.length > 0;
          const isError = issue.severity === "error";
          const panelId = `incidencia-${issue.key.replace(/\W+/g, "-")}`;
          const presentation = presentationForFormat(issue.format ?? format);

          return (
            <div
              key={issue.key}
              className={cn(
                "rounded-lg border transition-colors",
                isError ? "border-bad-line bg-bad-surface" : "border-warn-line bg-warn-surface"
              )}
            >
              <button
                onClick={() => setExpanded(isExpanded ? null : issue.key)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left"
              >
                {isError ? (
                  <XCircle className="h-4 w-4 shrink-0 text-bad" aria-hidden />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-strong">{issue.label}</span>
                    {issue.format && (
                      <span className="shrink-0 rounded border border-border bg-card px-1.5 py-px font-mono text-[10px] text-faint">
                        {issue.format}
                      </span>
                    )}
                    <span className={cn("shrink-0 text-[10px] font-semibold uppercase tracking-wide", isError ? "text-bad" : "text-warn")}>
                      {isError ? "Error" : "Aviso"}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ImpactBar count={issue.count} max={maxCount} severity={issue.severity} />
                  </div>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-2">
                  <span className={cn("text-sm font-bold tabular-nums", isError ? "text-bad" : "text-warn")}>
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
                  {description && (
                    <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                      <p className="text-xs leading-relaxed text-body">{description}</p>
                    </div>
                  )}
                  {hasSamples && (
                    <div className="rounded-md border border-border bg-card p-3">
                      <p className="eyebrow mb-2">{SAMPLES_LABEL[presentation]}</p>
                      {presentation === "table" ? (
                        <SampleTable samples={samples} />
                      ) : presentation === "record" ? (
                        <SampleRecords samples={samples} />
                      ) : (
                        <SamplePlain samples={samples} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
