import Link from "next/link";
import {
  TrendingUp, TrendingDown, Minus, Sparkles, AlertTriangle, Award, ClipboardList, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreForDataset } from "@/lib/quality";
import { datasetSlug } from "@/lib/utils";
import { TrendLine, Sparkline } from "@/components/quality/trend-chart";
import type { CatalogData } from "@/lib/types";
import type { QualityReport, HistorySnapshot } from "@/lib/quality-report";
import type { HistoryIndex } from "@/lib/quality-history";

const BUCKETS = [
  { label: "0–19", min: 0, max: 19 },
  { label: "20–39", min: 20, max: 39 },
  { label: "40–49", min: 40, max: 49 },
  { label: "50–59", min: 50, max: 59 },
  { label: "60–79", min: 60, max: 79 },
  { label: "80–100", min: 80, max: 100 },
] as const;

function bucketColor(label: string): string {
  if (label === "80–100") return "bg-ok-solid";
  if (label === "50–59" || label === "60–79") return "bg-warn-solid";
  return "bg-bad-solid";
}

/** Informes y días mínimos para que una tendencia deje de ser ruido. */
const MIN_SNAPSHOTS_FOR_TREND = 5;
const MIN_DAYS_FOR_TREND = 14;

export function EvolucionSection({
  catalog, report, index, snapshots,
}: {
  catalog: CatalogData;
  report: QualityReport | null;
  index: HistoryIndex | null;
  snapshots: HistorySnapshot[];
}) {
  const hasHistory = snapshots.length > 0;
  const latest = hasHistory ? snapshots[snapshots.length - 1] : null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  const rawScoreDelta =
    latest?.avgScore != null && previous?.avgScore != null
      ? Math.round((latest.avgScore - previous.avgScore) * 10) / 10
      : null;
  const rawErrorDelta = previous ? (latest?.error ?? 0) - previous.error : null;

  const metadataBySlug = new Map(catalog.datasets.map((d) => [datasetSlug(d.id), d.qualityScore]));
  const composites = (report?.datasets ?? []).map((ds) =>
    scoreForDataset(metadataBySlug.get(datasetSlug(ds.dataset_id)) ?? null, ds)
  );
  const withScore = composites.filter((s): s is number => s != null);
  const hist = BUCKETS.map((b) => ({ ...b, count: withScore.filter((s) => s >= b.min && s <= b.max).length }));
  const histMax = Math.max(1, ...hist.map((h) => h.count));

  const evolutions = Object.values(index?.datasets ?? {})
    .filter((d) => d.points.length >= 2)
    .map((d) => {
      const first = d.points[0].score;
      const last = d.points[d.points.length - 1].score;
      return { ...d, first, last, delta: last - first };
    })
    .sort((a, b) => b.delta - a.delta);

  const improvers = evolutions.filter((e) => e.delta > 0).slice(0, 6);
  const decliners = evolutions.filter((e) => e.delta < 0).slice(-6).reverse();

  const trendLabels = snapshots.map((s) => s.date.slice(5));
  const trendValues = snapshots.map((s) => s.avgScore ?? 0);

  /**
   * Una serie temporal necesita recorrido para significar algo. Con tres
   * informes tomados en dos días, la "tendencia" y los rankings de mejoras y
   * caídas son ruido de muestreo presentado como hallazgo: dos ejecuciones del
   * mismo día pueden diferir solo porque un servidor tardó en responder.
   * Mientras no haya recorrido, se enseña el estado actual y se dice por qué
   * falta lo demás.
   */
  const spanDays =
    snapshots.length > 1
      ? Math.round(
          (Date.parse(latest!.date) - Date.parse(snapshots[0].date)) / (1000 * 60 * 60 * 24)
        )
      : 0;
  const hasEnoughHistory = snapshots.length >= MIN_SNAPSHOTS_FOR_TREND && spanDays >= MIN_DAYS_FOR_TREND;

  // Las comparativas "vs anterior" solo se enseñan si comparar tiene sentido.
  const scoreDelta = hasEnoughHistory ? rawScoreDelta : null;
  const errorDelta = hasEnoughHistory ? rawErrorDelta : null;

  if (!hasHistory) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-faint">
          No hay datos históricos disponibles. Ejecuta el análisis de calidad para generar el primer informe.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-faint">
        {`Evolución del catálogo — ${snapshots.length} ${snapshots.length === 1 ? "informe" : "informes"} desde ${snapshots[0].date} hasta ${latest!.date}.`}
      </p>

      {!hasEnoughHistory && (
        <Card tone="warn">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            <div className="text-sm leading-relaxed text-body">
              <p className="font-semibold text-strong">Histórico todavía insuficiente para hablar de tendencia</p>
              <p className="mt-1">
                Hay {snapshots.length} {snapshots.length === 1 ? "informe" : "informes"}
                {spanDays > 0 ? ` repartidos en ${spanDays} ${spanDays === 1 ? "día" : "días"}` : " del mismo día"}.
                Con tan poco recorrido, la diferencia entre dos ejecuciones se explica más por el estado
                puntual de los servidores de origen que por un cambio real en los datos, así que la línea
                de evolución y los rankings de mejoras y caídas quedan ocultos.
              </p>
              <p className="mt-2 text-xs text-faint">
                Se mostrarán a partir de {MIN_SNAPSHOTS_FOR_TREND} informes repartidos en al menos{" "}
                {MIN_DAYS_FOR_TREND} días. Abajo sigues viendo el estado del último análisis.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resumen del último informe */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-5">
          <p className="text-xs text-faint">Score medio</p>
          <p className="text-3xl font-bold text-ok mt-1">{latest!.avgScore != null ? `${latest!.avgScore}%` : "—"}</p>
          {scoreDelta != null && (
            <p className={`text-xs mt-1 flex items-center gap-1 ${scoreDelta > 0 ? "text-ok" : scoreDelta < 0 ? "text-bad" : "text-faint"}`}>
              {scoreDelta > 0 ? <TrendingUp className="h-3 w-3" /> : scoreDelta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {scoreDelta > 0 ? "+" : ""}{scoreDelta}% vs anterior
            </p>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs text-faint">Correctas</p>
          <p className="text-3xl font-bold text-ok mt-1">{latest!.ok}</p>
          <p className="text-[11px] text-faint mt-1">{latest!.totalDistributions > 0 ? Math.round((latest!.ok / latest!.totalDistributions) * 100) : 0}% del total</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs text-faint">Con fallos</p>
          <p className="text-3xl font-bold text-bad mt-1">{latest!.error}</p>
          {errorDelta != null && (
            <p className={`text-xs mt-1 ${errorDelta > 0 ? "text-bad" : errorDelta < 0 ? "text-ok" : "text-faint"}`}>
              {errorDelta > 0 ? "+" : ""}{errorDelta} vs anterior
            </p>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <p className="text-xs text-faint">Datasets</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-ok">{latest!.healthyDatasets}</span>
            <span className="text-sm text-faint">/</span>
            <span className="text-sm text-warn">{latest!.warningDatasets}</span>
            <span className="text-sm text-faint">/</span>
            <span className="text-sm text-bad">{latest!.criticalDatasets}</span>
          </div>
          <p className="text-[11px] text-faint mt-1">sanos / aviso / críticos</p>
        </CardContent></Card>
      </div>

      {/* Observaciones automáticas */}
      {snapshots.length >= 2 && (
        <Card>
          <CardContent className="p-5 flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-warn mt-0.5 shrink-0" />
            <ul className="space-y-1.5 text-sm text-body">
              {scoreDelta != null && scoreDelta < -5 && (
                <li className="flex items-start gap-2"><AlertTriangle className="h-4 w-4 text-warn mt-0.5 shrink-0" />La calidad media ha bajado {Math.abs(scoreDelta)}% respecto al informe anterior.</li>
              )}
              {errorDelta != null && errorDelta > 0 && (
                <li className="flex items-start gap-2"><AlertTriangle className="h-4 w-4 text-bad mt-0.5 shrink-0" />Las distribuciones con fallos han aumentado en {errorDelta}.</li>
              )}
              {scoreDelta != null && scoreDelta > 5 && (
                <li className="flex items-start gap-2"><TrendingUp className="h-4 w-4 text-ok mt-0.5 shrink-0" />La calidad media ha mejorado {scoreDelta}% respecto al informe anterior.</li>
              )}
              {errorDelta != null && errorDelta < 0 && (
                <li className="flex items-start gap-2"><TrendingUp className="h-4 w-4 text-ok mt-0.5 shrink-0" />Las distribuciones con fallos han disminuido en {Math.abs(errorDelta)}.</li>
              )}
              {scoreDelta === 0 && errorDelta === 0 && (
                <li className="flex items-start gap-2"><Minus className="h-4 w-4 text-faint mt-0.5 shrink-0" />Sin cambios significativos respecto al informe anterior.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Línea de evolución */}
      {hasEnoughHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-faint" /> Evolución del score medio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLine labels={trendLabels} values={trendValues} />
            <p className="text-[11px] text-faint mt-2">{snapshots.length} informes en el historial</p>
          </CardContent>
        </Card>
      )}

      {/* Distribución de calidad compuesta */}
      {withScore.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="h-4 w-4 text-faint" /> Distribución de la calidad compuesta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {hist.map((h) => (
                <div key={h.label} className="flex items-center gap-3">
                  <span className="text-xs text-faint w-14 shrink-0 tabular-nums">{h.label}</span>
                  <div className="flex-1 h-6 rounded-md bg-fill overflow-hidden">
                    <div className={`h-full ${bucketColor(h.label)} transition-all`} style={{ width: `${(h.count / histMax) * 100}%` }} title={`${h.count} datasets`} />
                  </div>
                  <span className="text-xs text-body w-12 text-right tabular-nums">{h.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-faint">
              <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
              {withScore.length} datasets con score compuesto calculado
            </div>
          </CardContent>
        </Card>
      )}

      {/* Movers */}
      {hasEnoughHistory && evolutions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-ok" /> Mayores mejoras</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {improvers.length === 0 ? <p className="text-sm text-faint">Ningún dataset ha mejorado.</p> : improvers.map((e) => <MoverRow key={e.dataset_id} {...e} />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TrendingDown className="h-4 w-4 text-bad" /> Mayores caídas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {decliners.length === 0 ? <p className="text-sm text-faint">Ningún dataset ha empeorado.</p> : decliners.map((e) => <MoverRow key={e.dataset_id} {...e} />)}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabla completa (colapsada). Va detrás de la misma condición: es la
          misma trayectoria por dataset, y además `details` envía todas las
          filas —con un sparkline cada una— aunque estén plegadas. */}
      {hasEnoughHistory && evolutions.length > 0 && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-strong flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-faint" />
            Evolución por dataset
            <span className="text-[11px] font-normal text-faint">({evolutions.length} con ≥2 informes)</span>
          </summary>
          <div className="max-h-96 overflow-y-auto border-t border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-canvas">
                <tr className="text-left text-xs text-faint">
                  <th className="px-5 py-2 font-medium">Dataset</th>
                  <th className="px-3 py-2 font-medium text-right">Primero</th>
                  <th className="px-3 py-2 font-medium text-right">Último</th>
                  <th className="px-3 py-2 font-medium text-right">Δ</th>
                  <th className="px-5 py-2 font-medium">Trayectoria</th>
                </tr>
              </thead>
              <tbody>
                {evolutions.map((e) => (
                  <tr key={e.dataset_id} className="border-t border-border">
                    <td className="px-5 py-2">
                      <Link href={`/catalogo/${datasetSlug(e.dataset_id)}`} className="text-body hover:text-link hover:underline line-clamp-1 max-w-[28rem]">{e.title}</Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-faint">{e.first}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-body">{e.last}</td>
                    <td className="px-3 py-2 text-right"><DeltaBadge delta={e.delta} /></td>
                    <td className="px-5 py-2"><Sparkline points={e.points} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function MoverRow({
  title, dataset_id, first, last, delta, points,
}: {
  title: string;
  dataset_id: string;
  first: number;
  last: number;
  delta: number;
  points: { date: string; score: number }[];
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      <Link href={`/catalogo/${datasetSlug(dataset_id)}`} className="flex-1 min-w-0 text-body hover:text-link text-sm truncate">{title}</Link>
      <Sparkline points={points} />
      <span className="text-xs text-faint tabular-nums shrink-0">{first}→{last}</span>
      <DeltaBadge delta={delta} />
    </div>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-ok"><TrendingUp className="h-3 w-3" />+{delta}</span>;
  if (delta < 0) return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-bad"><TrendingDown className="h-3 w-3" />{delta}</span>;
  return <span className="text-[11px] text-faint">0</span>;
}
