import {
  AlertTriangle, CheckCircle2, XCircle, WifiOff, FileWarning, SearchCode, Database,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DownloadButton } from "@/components/ui/download-button";
import { buildAlerts, alertsToText } from "@/lib/alerts";
import { AlertasList } from "@/components/pages/AlertasList";
import { computeErrorBreakdown, categoryLabel, formatBytes } from "@/lib/quality-report";
import { isGeoFormat } from "@/lib/geo";
import type { CatalogData } from "@/lib/types";
import type { QualityReport } from "@/lib/quality-report";

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function IncidenciasSection({ report }: { catalog: CatalogData; report: QualityReport | null }) {
  if (!report) {
    return (
      <Card>
        <CardContent className="p-8 flex flex-col items-center justify-center text-center">
          <Database className="h-10 w-10 text-faint mb-3" />
          <h3 className="text-base font-semibold text-body">Sin informe de análisis</h3>
          <p className="text-sm text-faint mt-1 max-w-md">
            Ejecuta el análisis de calidad para detectar incidencias en las distribuciones.
          </p>
        </CardContent>
      </Card>
    );
  }

  const alerts = buildAlerts(report);
  const critical = alerts.filter((a) => a.level === "critical").length;
  const warning = alerts.filter((a) => a.level === "warning").length;

  const breakdown = computeErrorBreakdown(report);
  const totalIssues = breakdown.availability + breakdown.format + breakdown.content;
  const breakdownItems = [
    { key: "availability", count: breakdown.availability, icon: WifiOff, color: "text-bad", bg: "bg-bad-surface", desc: "URL caídas, timeouts, 404" },
    { key: "format", count: breakdown.format, icon: FileWarning, color: "text-warn", bg: "bg-warn-surface", desc: "JSON/XML inválido, formato incorrecto" },
    { key: "content", count: breakdown.content, icon: SearchCode, color: "text-info", bg: "bg-info-surface", desc: "Celdas vacías, tipos, encabezados" },
  ] as const;

  const byFormat = Object.entries(report.by_format).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="space-y-8">
      {/* Alertas accionables */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-strong">Alertas priorizadas</h2>
            <p className="text-sm text-faint mt-0.5">
              {alerts.length} datasets con problemas accionables:{" "}
              <span className="text-bad font-medium">{critical} críticos</span> (recursos inutilizables) y{" "}
              <span className="text-warn font-medium">{warning} advertencias</span> (contenido con errores).
            </p>
          </div>
          {alerts.length > 0 && (
            <DownloadButton
              content={alertsToText(alerts)}
              filename="alertas-calidad.txt"
              label="Exportar TXT"
              className="shrink-0"
            />
          )}
        </div>
        <AlertasList alerts={alerts} />
      </section>

      {/* Desglose del análisis */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-strong">Desglose del análisis de contenido</h2>

        {totalIssues > 0 && (
          <Card>
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-body flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-warn" />
                {totalIssues.toLocaleString("es-ES")} incidencias por categoría
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {breakdownItems.map((item) => (
                  <div key={item.key} className="flex items-start gap-3 rounded-lg border border-border p-3">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${item.bg} shrink-0`}>
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                    </div>
                    <div>
                      <p className={`text-lg font-bold ${item.color}`}>{item.count.toLocaleString("es-ES")}</p>
                      <p className="text-xs font-medium text-body">{categoryLabel(item.key)}</p>
                      <p className="text-[10px] text-faint mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm">Resultados por formato</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-faint border-b border-border">
                    <th className="py-2 pr-4 font-medium">Formato</th>
                    <th className="py-2 pr-4 font-medium text-right">Total</th>
                    <th className="py-2 pr-4 font-medium text-right">OK</th>
                    <th className="py-2 pr-4 font-medium text-right">Fallos</th>
                    <th className="py-2 pr-4 font-medium text-right">Omitidas</th>
                    <th className="py-2 pr-4 font-medium text-right">Score medio</th>
                    <th className="py-2 font-medium text-right">Descargado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {byFormat.map(([fmt, f]) => (
                    <tr key={fmt} className="hover:bg-fill">
                      <td className="py-2.5 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant="format">{fmt}</Badge>
                          {f.error === 0 ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-bad" />
                          )}
                          {isGeoFormat(fmt) && <span className="text-[10px] text-faint">geo</span>}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right text-body tabular-nums">{f.total}</td>
                      <td className="py-2.5 pr-4 text-right text-ok tabular-nums">{f.ok}</td>
                      <td className="py-2.5 pr-4 text-right text-bad tabular-nums">{f.error}</td>
                      <td className="py-2.5 pr-4 text-right text-faint tabular-nums">{f.skipped}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-body tabular-nums">
                        {f.avg_score != null ? `${f.avg_score}%` : "—"}
                      </td>
                      <td className="py-2.5 text-right text-faint tabular-nums">{formatBytes(f.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-faint mt-3">
              Los recursos geoespaciales suelen ser los peor valorados: muchos Shapefile no son ZIP válidos y
              los enlaces GML/KML/ECW no responden. Los servicios WMS/WFS, en cambio, funcionan.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs text-faint">Distribuciones</p>
            <p className="text-2xl font-bold text-strong mt-1">{report.totals.distributions}</p>
            <p className="text-[11px] text-faint mt-0.5">{formatBytes(report.totals.bytes)} descargados</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-faint">Correctas</p>
            <p className="text-2xl font-bold text-ok mt-1">{report.totals.ok}</p>
            <p className="text-[11px] text-faint mt-0.5">{pct(report.totals.ok, report.totals.distributions)}% del total</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-faint">Con fallos</p>
            <p className="text-2xl font-bold text-bad mt-1">{report.totals.error}</p>
            <p className="text-[11px] text-faint mt-0.5">{pct(report.totals.error, report.totals.distributions)}% del total</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-faint">Score medio</p>
            <p className="text-2xl font-bold text-ok mt-1">{report.totals.avg_score != null ? `${report.totals.avg_score}%` : "—"}</p>
            <p className="text-[11px] text-faint mt-0.5">solo analizables</p>
          </CardContent></Card>
        </div>
      </section>
    </div>
  );
}
