import Link from "next/link";
import { Building2, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toDatasetLite } from "@/lib/quality-report";
import { datasetSlug, cn } from "@/lib/utils";
import { scoreForDataset, getScoreColor } from "@/lib/quality";
import type { CatalogData } from "@/lib/types";
import type { QualityReport } from "@/lib/quality-report";

type PublisherStats = {
  uri: string;
  name: string;
  datasets: number;
  avgMetaScore: number | null;
  avgContentScore: number | null;
  avgComposite: number | null;
  healthy: number;
  warning: number;
  critical: number;
  analyzed: number;
  failed: number;
  total: number;
};

function pubSlug(uri: string) {
  return uri.replace(/\/+$/, "").match(/(\d+)$/)?.[1] ?? encodeURIComponent(uri);
}

export function OrganismosSection({ catalog, report }: { catalog: CatalogData; report: QualityReport | null }) {
  const analysisBySlug: Record<string, ReturnType<typeof toDatasetLite>> = report
    ? Object.fromEntries(report.datasets.map((ds) => [datasetSlug(ds.dataset_id), toDatasetLite(ds)]))
    : {};

  const reportBySlug = new Map((report?.datasets ?? []).map((d) => [datasetSlug(d.dataset_id), d]));
  const byPublisher = new Map<string, PublisherStats>();

  for (const ds of catalog.datasets) {
    const uri = ds.publisher;
    if (!uri) continue;
    const name = ds.publisherName ?? uri.replace(/\/+$/, "").split("/").pop()?.replace(/[-_]/g, " ") ?? uri;

    if (!byPublisher.has(uri)) {
      byPublisher.set(uri, { uri, name, datasets: 0, avgMetaScore: null, avgContentScore: null, avgComposite: null, healthy: 0, warning: 0, critical: 0, analyzed: 0, failed: 0, total: 0 });
    }
    const p = byPublisher.get(uri)!;
    p.datasets += 1;
    p.total += 1;
    if (ds.status === "healthy") p.healthy++;
    else if (ds.status === "warning") p.warning++;
    else p.critical++;

    const analysis = analysisBySlug[datasetSlug(ds.id)];
    if (analysis) {
      p.analyzed += analysis.analyzed;
      p.failed += analysis.failed;
    }
  }

  for (const [uri, p] of byPublisher) {
    const pDatasets = catalog.datasets.filter((d) => d.publisher === uri);
    const metaScores = pDatasets.map((d) => d.qualityScore).filter((s): s is number => s != null);
    p.avgMetaScore = metaScores.length > 0 ? Math.round(metaScores.reduce((a, b) => a + b, 0) / metaScores.length) : null;
    const contentScores: number[] = [];
    for (const ds of pDatasets) {
      const analysis = analysisBySlug[datasetSlug(ds.id)];
      if (analysis?.score != null) contentScores.push(analysis.score);
    }
    p.avgContentScore = contentScores.length > 0 ? Math.round(contentScores.reduce((a, b) => a + b, 0) / contentScores.length) : null;
    // Media de los compuestos, no compuesto de las medias: si se promedia cada
    // eje por separado, los datasets con todos los archivos rotos se diluyen.
    const composites = pDatasets
      .map((d) => scoreForDataset(d.qualityScore, reportBySlug.get(datasetSlug(d.id))))
      .filter((s): s is number => s != null);
    p.avgComposite = composites.length > 0
      ? Math.round(composites.reduce((a, b) => a + b, 0) / composites.length)
      : null;
  }

  const publishers = Array.from(byPublisher.values()).sort(
    (a, b) => (b.avgComposite ?? b.avgMetaScore ?? 0) - (a.avgComposite ?? a.avgMetaScore ?? 0)
  );
  const totalOrgs = publishers.length;
  const top3 = publishers.slice(0, 3);
  const bottom3 = [...publishers].reverse().slice(0, 3);

  return (
    <div className="space-y-8">
      <p className="text-sm text-faint">
        {totalOrgs} organismos publicadores. Calidad compuesta = metadatos + análisis de contenido.
      </p>

      {/* Top / Bottom */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section>
          <h2 className="text-sm font-semibold text-strong flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-ok" /> Mejor calidad
          </h2>
          <div className="space-y-2">
            {top3.map((p) => (
              <Link key={p.uri} href={`#pub-${pubSlug(p.uri)}`} className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-fill p-3 transition-colors">
                <span className={cn("text-lg font-bold tabular-nums w-10 shrink-0", p.avgComposite != null ? getScoreColor(p.avgComposite) : "text-faint")}>
                  {p.avgComposite ?? "—"}{p.avgComposite != null ? "%" : ""}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-strong truncate">{p.name}</p>
                  <p className="text-[10px] text-faint">{p.datasets} datasets</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section>
          <h2 className="text-sm font-semibold text-strong flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-bad" /> Menor calidad
          </h2>
          <div className="space-y-2">
            {bottom3.map((p) => (
              <Link key={p.uri} href={`#pub-${pubSlug(p.uri)}`} className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-fill p-3 transition-colors">
                <span className={cn("text-lg font-bold tabular-nums w-10 shrink-0", p.avgComposite != null ? getScoreColor(p.avgComposite) : "text-faint")}>
                  {p.avgComposite ?? "—"}{p.avgComposite != null ? "%" : ""}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-strong truncate">{p.name}</p>
                  <p className="text-[10px] text-faint">{p.datasets} datasets</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Tabla */}
      <section>
        <h2 className="text-sm font-semibold text-strong flex items-center gap-2 mb-4">
          <Building2 className="h-4 w-4 text-faint" />
          Todos los organismos <span className="font-normal text-faint">({totalOrgs})</span>
        </h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-fill text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 text-left">Organismo</th>
                  <th className="px-4 py-2.5 text-right">Datasets</th>
                  <th className="px-4 py-2.5 text-right">Score meta</th>
                  <th className="px-4 py-2.5 text-right">Score análisis</th>
                  <th className="px-4 py-2.5 text-right">Compuesto</th>
                  <th className="px-4 py-2.5 text-center">Estado</th>
                  <th className="px-4 py-2.5 text-right">Analizadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {publishers.map((p) => (
                  <tr key={p.uri} id={`pub-${pubSlug(p.uri)}`} className="hover:bg-fill transition-colors scroll-mt-24">
                    <td className="px-4 py-3">
                      <Link href={`/catalogo?q=${encodeURIComponent(p.name)}`} className="font-medium text-body hover:text-link transition-colors" title={p.uri}>
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-faint">{p.datasets}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={cn("font-semibold", p.avgMetaScore != null ? getScoreColor(p.avgMetaScore) : "text-faint")}>
                        {p.avgMetaScore != null ? `${p.avgMetaScore}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={cn("font-semibold", p.avgContentScore != null ? getScoreColor(p.avgContentScore) : "text-faint")}>
                        {p.avgContentScore != null ? `${p.avgContentScore}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={cn("font-bold", p.avgComposite != null ? getScoreColor(p.avgComposite) : "text-faint")}>
                        {p.avgComposite != null ? `${p.avgComposite}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {p.healthy > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-ok"><CheckCircle2 className="h-3 w-3" /> {p.healthy}</span>}
                        {p.warning > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-warn"><AlertTriangle className="h-3 w-3" /> {p.warning}</span>}
                        {p.critical > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] text-bad"><XCircle className="h-3 w-3" /> {p.critical}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[10px] text-faint tabular-nums">{p.analyzed}/{p.total} dist.</span>
                        {p.total > 0 && (
                          <div className="w-20 h-1 bg-fill rounded-full overflow-hidden">
                            <div className="h-full bg-ok-solid rounded-full" style={{ width: `${Math.round((p.analyzed / Math.max(p.total, 1)) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}
