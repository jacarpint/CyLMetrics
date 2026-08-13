import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2, FileWarning, ListChecks, SearchCode, Tags, Wrench,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { summarizeDelivery, summarizeContent, type SystemicCause } from "@/lib/availability";
import { buildRepairActions, DIMENSION_LABELS, type ActionFamily, type RepairAction } from "@/lib/repair-actions";
import type { CatalogData } from "@/lib/types";
import type { QualityReport } from "@/lib/quality-report";

/** Cuántas acciones se pintan antes de remitir a la pestaña correspondiente. */
const VISIBLE_ACTIONS = 12;

/** Distintivo e icono de cada familia. El destino lo trae ya cada acción en `href`. */
const FAMILY_STYLE: Record<ActionFamily, { badge: string; icon: typeof FileWarning }> = {
  entrega: { badge: "border-bad-line bg-bad-surface text-bad", icon: FileWarning },
  contenido: { badge: "border-warn-line bg-warn-surface text-warn", icon: SearchCode },
  metadatos: { badge: "border-info-line bg-info-surface text-info", icon: Tags },
};

/**
 * Lo primero que ve quien publica: su lista de tareas.
 *
 * Las tres familias de defecto se presentan juntas y ordenadas por lo que se
 * recupera al corregirlas, cada una con su «qué hacer» al lado. Deliberadamente
 * no es un cuadro de mando de indicadores agregados —media de calidad, reparto
 * por temática, formatos más usados—: de una media no sale ninguna tarea.
 */
export function PrioridadesSection({
  catalog,
  report,
  causes,
  contentAffected,
}: {
  catalog: CatalogData;
  report: QualityReport | null;
  causes: SystemicCause[];
  /**
   * Archivos que abren pero traen algún error de contenido, contados una sola
   * vez cada uno.
   *
   * Llega calculado desde la página, de las mismas filas que alimentan la pestaña
   * Archivos, para que las dos vistas no puedan dar cifras distintas del mismo
   * hecho. No se puede derivar aquí a partir de las acciones: el máximo de
   * `affected` entre ellas es el recuento de la incidencia más frecuente, no el
   * de archivos afectados, y sale siempre por debajo del real.
   */
  contentAffected: number;
}) {
  const delivery = summarizeDelivery(report);
  const content = summarizeContent(report);
  const actions = buildRepairActions({ causes, report, datasets: catalog.datasets });

  const shown = actions.slice(0, VISIBLE_ACTIONS);
  const hidden = actions.length - shown.length;

  const metadataDatasets = new Set<string>();
  for (const ds of catalog.datasets) {
    if (ds.metadataGaps.some((g) => g !== "sin-identificador" && g !== "sin-punto-contacto")) {
      metadataDatasets.add(ds.id);
    }
  }

  const stateCards = [
    {
      family: "entrega" as const,
      value: (delivery.roto + delivery.noEntrega).toLocaleString("es-ES"),
      label: "archivos que no se pueden usar",
      detail: `${delivery.roto.toLocaleString("es-ES")} no abren · ${delivery.noEntrega.toLocaleString("es-ES")} no entregan el archivo`,
      href: "/calidad?vista=ficheros",
    },
    {
      family: "contenido" as const,
      value: contentAffected.toLocaleString("es-ES"),
      label: "archivos que abren con errores en los datos",
      detail: `sobre los ${content.scored.toLocaleString("es-ES")} que se pueden leer`,
      href: "/calidad?vista=ficheros&familia=contenido",
    },
    {
      family: "metadatos" as const,
      value: metadataDatasets.size.toLocaleString("es-ES"),
      label: "conjuntos de datos con la ficha incompleta",
      detail: `de ${catalog.stats.totalDatasets.toLocaleString("es-ES")} publicados`,
      href: "/calidad?vista=metadatos",
    },
  ];

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm leading-relaxed text-body">
        Esta sección está pensada para quien <strong className="text-strong">publica</strong> los
        datos. Reúne todo lo que el análisis ha encontrado en el catálogo, agrupado por la corrección
        que hay que hacer y ordenado por lo que se recupera al hacerla. Quien busca datos para
        reutilizarlos tiene el{" "}
        <Link href="/catalogo" className="font-medium text-link underline-offset-2 hover:underline">
          catálogo
        </Link>
        .
      </p>

      {/* ── Estado en tres cifras ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stateCards.map((s) => {
          const Icon = FAMILY_STYLE[s.family].icon;
          return (
            <Link
              key={s.family}
              href={s.href}
              className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-border-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <p className="eyebrow mb-3 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {DIMENSION_LABELS[s.family]}
              </p>
              <p className="text-3xl font-bold tabular-nums text-strong">{s.value}</p>
              <p className="mt-1 text-sm font-medium text-body">{s.label}</p>
              <p className="mt-1.5 text-xs text-faint">{s.detail}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-link">
                Ver la lista
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>

      {/* ── La lista de tareas ── */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
          <ListChecks className="h-4 w-4 text-faint" aria-hidden />
          Qué arreglar primero
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-faint">
          Un mismo fallo repetido en muchos archivos no son N incidencias: es una. Cuando algo falla
          en todos los archivos de un formato aparece arriba, porque delata un proceso de publicación
          y se corrige de una vez.
        </p>

        {actions.length === 0 ? (
          <Card tone="ok" className="mt-4">
            <CardContent className="flex items-start gap-3 p-6">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-strong">Nada pendiente</h3>
                <p className="mt-1 text-sm text-body">
                  El análisis no ha encontrado problemas de disponibilidad, de contenido ni campos de
                  metadatos pendientes en el catálogo.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <ol className="mt-4 space-y-3">
              {shown.map((action, i) => (
                <li key={action.key}>
                  <ActionCard action={action} position={i + 1} />
                </li>
              ))}
            </ol>
            {hidden > 0 && (
              <p className="mt-4 text-sm text-faint">
                Y {hidden.toLocaleString("es-ES")} {hidden === 1 ? "tarea" : "tareas"} más de menor
                alcance. El detalle completo, archivo a archivo, está en{" "}
                <Link href="/calidad?vista=ficheros" className="font-medium text-link underline-offset-2 hover:underline">
                  Archivos
                </Link>{" "}
                y{" "}
                <Link href="/calidad?vista=metadatos" className="font-medium text-link underline-offset-2 hover:underline">
                  Metadatos
                </Link>
                .
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ActionCard({ action, position }: { action: RepairAction; position: number }) {
  const style = FAMILY_STYLE[action.family];
  const Icon = style.icon;

  return (
    <Card tone={action.wholeFormat ? "bad" : "default"}>
      <CardContent className="flex gap-4 p-4">
        <span className="mt-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fill text-xs font-semibold tabular-nums text-faint sm:flex">
          {position}
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                style.badge
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
              {DIMENSION_LABELS[action.family]}
            </span>
            {action.format && <Badge variant="format" className="text-[11px]">{action.format}</Badge>}
            {action.wholeFormat && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-bad">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Todo el formato
              </span>
            )}
          </div>

          <h3 className="text-sm font-semibold text-strong">{action.title}</h3>

          <p className="mt-1 text-xs tabular-nums text-faint">
            <strong className="text-body">{action.affected.toLocaleString("es-ES")}</strong>
            {action.scopeTotal != null && action.scopeTotal !== action.affected
              ? ` de ${action.scopeTotal.toLocaleString("es-ES")}`
              : ""}{" "}
            {action.unit}
            {action.datasets != null && (
              <>
                {" "}· {action.datasets.toLocaleString("es-ES")}{" "}
                {action.datasets === 1 ? "conjunto de datos" : "conjuntos de datos"}
              </>
            )}
          </p>

          {/* El «qué hacer»: sin esto la tarjeta describe el fallo y deja al
              publicador con la tarea sin empezar. */}
          <p className="mt-2 flex items-start gap-1.5 text-sm leading-relaxed text-body">
            <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <span>{action.action}</span>
          </p>

          {action.why && (
            <p className="mt-1.5 text-xs leading-relaxed text-faint">{action.why}</p>
          )}

          <Link
            href={action.href}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-link underline-offset-2 hover:underline"
          >
            Ver los {action.unit} afectados
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
