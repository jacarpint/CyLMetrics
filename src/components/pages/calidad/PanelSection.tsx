import Link from "next/link";
import {
  BarChart3, CheckCircle2, AlertTriangle, Activity, Database, TrendingUp,
  Scale, FileCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { datasetSlug } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { CatalogData, Category } from "@/lib/types";
import type { QualityReport } from "@/lib/quality-report";

type Kpi = {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  valueColor: string;
  bar: number | null;
  barColor?: string;
  note?: string;
};

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function PanelSection({ catalog }: { catalog: CatalogData; report: QualityReport | null }) {
  const { stats } = catalog;
  const total = stats.totalDatasets;

  const openLicenseCount = stats.licenseBreakdown["CC-BY-4.0"] ?? 0;
  const openLicensePct = pct(openLicenseCount, total);
  const openFormatCount = catalog.datasets.filter((ds) =>
    ds.formats.some((f) => f === "CSV" || f === "JSON")
  ).length;
  const openFormatPct = pct(openFormatCount, total);

  const byCategory = catalog.datasets.reduce<Partial<Record<Category, { count: number; sum: number }>>>(
    (acc, ds) => {
      const entry = (acc[ds.category] ??= { count: 0, sum: 0 });
      entry.count += 1;
      entry.sum += ds.qualityScore;
      return acc;
    },
    {}
  );
  const categoryQuality = Object.entries(byCategory)
    .map(([name, v]) => ({ name: name as Category, count: v!.count, score: Math.round((v!.sum / v!.count) * 10) / 10 }))
    .sort((a, b) => b.count - a.count);

  const topFormats = Object.entries(stats.formatsBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const sorted = [...catalog.datasets].sort((a, b) => b.qualityScore - a.qualityScore);
  const best = sorted.slice(0, 5);
  const worst = [...sorted].reverse().slice(0, 5);

  const KPIS: Kpi[] = [
    { icon: Database, iconBg: "bg-fill", iconColor: "text-body", label: "Total datasets", value: total, valueColor: "text-strong", bar: null, note: "Indexados en JCyL" },
    { icon: TrendingUp, iconBg: "bg-info-surface", iconColor: "text-info", label: "Calidad media", value: `${stats.averageQuality}%`, valueColor: "text-info", bar: stats.averageQuality, barColor: "bg-info" },
    { icon: CheckCircle2, iconBg: "bg-ok-surface", iconColor: "text-ok", label: "Saludables", value: stats.healthyCount, valueColor: "text-ok", bar: pct(stats.healthyCount, total), barColor: "bg-ok-solid" },
    { icon: AlertTriangle, iconBg: "bg-warn-surface", iconColor: "text-warn", label: "Advertencias", value: stats.warningCount, valueColor: "text-warn", bar: pct(stats.warningCount, total), barColor: "bg-warn-solid" },
    { icon: Activity, iconBg: "bg-bad-surface", iconColor: "text-bad", label: "Críticos", value: stats.criticalCount, valueColor: "text-bad", bar: pct(stats.criticalCount, total), barColor: "bg-bad-solid" },
  ];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {KPIS.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${k.iconBg}`}>
                  <k.icon className={`h-4 w-4 ${k.iconColor}`} />
                </div>
                <span className="text-sm font-medium text-faint">{k.label}</span>
              </div>
              <p className={`text-3xl font-bold ${k.valueColor}`}>{k.value}</p>
              {k.bar != null && (
                <Progress value={k.bar} className="mt-3" indicatorClassName={k.barColor} />
              )}
              {k.note && <p className="text-xs text-faint mt-1">{k.note}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mejores / peores */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Mejores datasets</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {best.map((ds) => (
                <Link key={ds.id} href={`/catalogo/${datasetSlug(ds.id)}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-fill rounded-lg px-2 transition-colors">
                  <span className="text-sm text-body truncate">{ds.title}</span>
                  <Badge variant="success">{ds.qualityScore}%</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Datasets a mejorar</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {worst.map((ds) => (
                <Link key={ds.id} href={`/catalogo/${datasetSlug(ds.id)}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-fill rounded-lg px-2 transition-colors">
                  <span className="text-sm text-body truncate">{ds.title}</span>
                  <Badge variant="destructive">{ds.qualityScore}%</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Apertura */}
      <div>
        <h2 className="text-base font-semibold text-strong flex items-center gap-2">
          <Scale className="h-4 w-4 text-info" />
          Apertura y transparencia
        </h2>
        <p className="text-sm text-faint mt-0.5">Indicadores de apertura respecto a los principios de datos abiertos.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-ok-surface">
                <FileCheck className="h-4 w-4 text-ok" />
              </div>
              <span className="text-sm font-medium text-faint">Licencia abierta (CC-BY)</span>
            </div>
            <p className="text-2xl font-bold text-strong mb-1">{openLicensePct}%</p>
            <p className="text-xs text-faint">{openLicenseCount} de {total} datasets con CC-BY-4.0</p>
            <Progress value={openLicensePct} className="mt-3" indicatorClassName="bg-ok-solid" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-info-surface">
                <BarChart3 className="h-4 w-4 text-info" />
              </div>
              <span className="text-sm font-medium text-faint">Formato abierto (CSV/JSON)</span>
            </div>
            <p className="text-2xl font-bold text-strong mb-1">{openFormatPct}%</p>
            <p className="text-xs text-faint">{openFormatCount} datasets en formatos abiertos estándar</p>
            <Progress value={openFormatPct} className="mt-3" indicatorClassName="bg-info" />
          </CardContent>
        </Card>
      </div>

      {openLicensePct < 50 && (
        <Card className="border-warn-line bg-warn-surface">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warn mt-0.5 shrink-0" />
            <p className="text-sm text-body leading-relaxed">
              <strong className="text-strong">Oportunidad de mejora:</strong> Solo el {openLicensePct}% de los
              datasets tienen licencia CC-BY-4.0. El resto usa IGCYL-NC (uso no comercial), lo que limita la
              reutilización por empresas y desarrolladores.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Categoría / formatos / licencias */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-faint" />
              Calidad por categoría
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categoryQuality.map((cat) => (
                <div key={cat.name} className="flex items-center gap-4">
                  <span className="text-sm text-body w-36 shrink-0 truncate">{cat.name}</span>
                  <Progress
                    value={cat.score}
                    className="flex-1"
                    indicatorClassName={cat.score >= 80 ? "bg-ok-solid" : cat.score >= 60 ? "bg-warn-solid" : "bg-bad-solid"}
                  />
                  <span className="text-sm font-semibold text-body w-12 text-right">{cat.score}%</span>
                  <span className="text-[10px] text-faint w-14 text-right tabular-nums">{cat.count} ds</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">Formatos más usados</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topFormats.map(([fmt, count]) => (
                  <div key={fmt} className="flex items-center gap-4">
                    <span className="text-sm text-body font-mono w-16 shrink-0">{fmt}</span>
                    <Progress value={pct(count, total)} className="flex-1" indicatorClassName="bg-ok-solid" />
                    <span className="text-xs text-faint w-16 text-right tabular-nums">{count} ds</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Licencias del catálogo</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries(stats.licenseBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([lic, count]) => (
                    <div key={lic} className="flex items-center gap-4">
                      <span className="text-sm text-body flex-1">{lic}</span>
                      <Progress value={pct(count, total)} className="flex-1" indicatorClassName="bg-ok-solid" />
                      <span className="text-xs text-faint w-16 text-right tabular-nums">{pct(count, total)}%</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
