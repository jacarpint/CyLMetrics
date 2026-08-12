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

/**
 * Cubos de 20 puntos, todos iguales.
 *
 * Antes eran 0–19, 20–39, 40–49, 50–59, 60–79 y 80–100: barras de la misma
 * anchura visual sobre rangos de 20, 20, 10, 10, 20 y 21 puntos, así que dos
 * barras iguales podían significar densidades muy distintas.
 */
const BUCKETS = [
  { label: "0–19", min: 0, max: 19 },
  { label: "20–39", min: 20, max: 39 },
  { label: "40–59", min: 40, max: 59 },
  { label: "60–79", min: 60, max: 79 },
  { label: "80–100", min: 80, max: 100 },
] as const;

/** Los umbrales del portal: <50 deficiente, 50–79 mejorable, ≥80 buena. */
function bucketColor(min: number): string {
  if (min >= 80) return "bg-ok-solid";
  if (min >= 50) return "bg-warn-solid";
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

  /**
   * Observaciones que se pueden afirmar con lo que hay. Se calculan antes de
   * pintar: sin esto la tarjeta se dibujaba con una lista vacía dentro siempre
   * que hubiera ≥2 informes pero no bastante recorrido para comparar, que es
   * justo el estado actual del historial.
   */
  const observations: { key: string; tone: "ok" | "warn" | "bad" | "flat"; text: string }[] = [];
  if (scoreDelta != null && scoreDelta < -5) {
    observations.push({ key: "score-baja", tone: "warn", text: `La calidad media ha bajado ${Math.abs(scoreDelta)} puntos respecto al informe anterior.` });
  }
  if (scoreDelta != null && scoreDelta > 5) {
    observations.push({ key: "score-sube", tone: "ok", text: `La calidad media ha mejorado ${scoreDelta} puntos respecto al informe anterior.` });
  }
  if (errorDelta != null && errorDelta > 0) {
    observations.push({ key: "errores-suben", tone: "bad", text: `Las distribuciones con fallos han aumentado en ${errorDelta}.` });
  }
  if (errorDelta != null && errorDelta < 0) {
    observations.push({ key: "errores-bajan", tone: "ok", text: `Las distribuciones con fallos han disminuido en ${Math.abs(errorDelta)}.` });
  }
  if (observations.length === 0 && scoreDelta != null && errorDelta != null) {
    observations.push({ key: "sin-cambios", tone: "flat", text: "Sin cambios significativos respecto al informe anterior." });
  }

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
          <p className="text-xs text-faint">Calidad del contenido</p>
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
        {/* Los datasets sin una sola distribución legible se cuentan aparte, no
            se omiten: omitiéndolos, la tarjeta enseñaba «436 / 0 / 0» de 824 y
            afirmaba «0 críticos» a la vez que el portal decía que un tercio de
            los archivos no abre. */}
        <Card><CardContent className="p-5">
          <p className="text-xs text-faint">Datasets por contenido</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-ok">{latest!.healthyDatasets}</span>
            <span className="text-sm text-faint">/</span>
            <span className="text-sm text-warn">{latest!.warningDatasets}</span>
            <span className="text-sm text-faint">/</span>
            <span className="text-sm text-bad">{latest!.criticalDatasets}</span>
            {latest!.unscoredDatasets > 0 && (
              <>
                <span className="text-sm text-faint">/</span>
                <span className="text-sm text-faint">{latest!.unscoredDatasets}</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-faint mt-1">
            buena / mejorable / deficiente
            {latest!.unscoredDatasets > 0 && " / sin medir"}
          </p>
          {latest!.unscoredDatasets > 0 && (
            <p className="text-[11px] text-faint mt-1 leading-relaxed">
              «Sin medir» son {latest!.unscoredDatasets.toLocaleString("es-ES")} de{" "}
              {latest!.totalDatasets.toLocaleString("es-ES")} datasets sin ningún archivo legible:
              no tienen contenido que puntuar.
            </p>
          )}
        </CardContent></Card>
      </div>

      {/* Observaciones automáticas */}
      {observations.length > 0 && (
        <Card>
          <CardContent className="p-5 flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-warn mt-0.5 shrink-0" aria-hidden />
            <ul className="space-y-1.5 text-sm text-body">
              {observations.map((o) => {
                const Icon = o.tone === "ok" ? TrendingUp : o.tone === "flat" ? Minus : AlertTriangle;
                const color =
                  o.tone === "ok" ? "text-ok" : o.tone === "bad" ? "text-bad" : o.tone === "warn" ? "text-warn" : "text-faint";
                return (
                  <li key={o.key} className="flex items-start gap-2">
                    <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} aria-hidden />
                    {o.text}
                  </li>
                );
              })}
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
                    <div className={`h-full ${bucketColor(h.min)} transition-all`} style={{ width: `${(h.count / histMax) * 100}%` }} title={`${h.count} datasets`} />
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
