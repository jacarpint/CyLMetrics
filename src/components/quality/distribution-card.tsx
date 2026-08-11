import Link from 'next/link';
import { ExternalLink, CheckCircle2, XCircle, AlertTriangle, SkipForward, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getScoreColor, getScoreBorderColor } from '@/lib/quality';
import { formatBytes, formatDuration, type DistributionResult, type IssueInfo } from '@/lib/quality-report';

/** Círculo de puntuación (mismo estilo que el explorador de catálogo). */
export function ScoreCircle({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-border text-faint font-bold text-lg shrink-0">
        —
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center w-14 h-14 rounded-full border-2 font-bold text-lg shrink-0',
        getScoreBorderColor(score),
        getScoreColor(score)
      )}
    >
      {score}
    </div>
  );
}

export function statusBadge(status: DistributionResult['status']) {
  if (status === 'ok')
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  if (status === 'skipped')
    return (
      <Badge variant="default" className="gap-1">
        <SkipForward className="h-3 w-3" /> Omitida
      </Badge>
    );
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Con fallos
    </Badge>
  );
}

export function severityBadge(severity: IssueInfo['severity']) {
  return severity === 'warning' ? (
    <Badge variant="warning" className="gap-1 text-[10px]">
      <AlertTriangle className="h-3 w-3" /> warning
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1 text-[10px]">
      <XCircle className="h-3 w-3" /> error
    </Badge>
  );
}

const METRIC_LABELS: Record<string, string> = {
  rows: 'Filas',
  columns: 'Columnas',
  delimiter: 'Delimitador',
  encoding: 'Codificación',
  error_cells: 'Celdas con error',
  sheet_count: 'Hojas',
  total_rows: 'Filas totales',
  json_objects: 'Objetos JSON',
  kind: 'Estructura',
  elements: 'Elementos',
  total_elements: 'Elementos',
  root: 'Raíz',
  root_local: 'Raíz',
  items: 'Registros',
  lines: 'Líneas',
  service: 'Servicio',
  version: 'Versión',
  feature_types: 'Tipos de entidad',
  features: 'Entidades',
  fields: 'Campos',
  layers: 'Capas',
  size_bytes: 'Tamaño (bytes)',
  http_status: 'Respuesta HTTP',
  has_projection: 'Incluye proyección',
};

/** Muestra las métricas escalares del análisis y las hojas (XLSX) si existen. */
export function MetricsBlock({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics).filter(
    ([key, value]) =>
      key !== 'sample_rows' &&
      key !== 'sheets' &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
  );
  const sheets = metrics.sheets;

  if (entries.length === 0 && !Array.isArray(sheets)) return null;

  return (
    <div className="mt-3 rounded-lg bg-fill border border-border p-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key}>
            <p className="text-[10px] uppercase tracking-wider text-faint">{METRIC_LABELS[key] ?? key}</p>
            <p className="text-sm font-semibold text-body tabular-nums">
              {typeof value === 'number' && value > 1000 ? value.toLocaleString('es-ES') : String(value)}
            </p>
          </div>
        ))}
      </div>
      {Array.isArray(sheets) && sheets.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-faint mb-1.5">Hojas</p>
          <div className="flex flex-wrap gap-1.5">
            {(sheets as { name?: string; rows?: number; columns?: number }[]).map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-card border border-border px-2 py-1 text-[11px] text-body">
                <span className="font-medium">{s.name || `Hoja ${i + 1}`}</span>
                <span className="text-faint">
                  {s.rows?.toLocaleString('es-ES') ?? 0}×{s.columns ?? 0}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Detalle de una distribución: descarga + análisis + incidencias. */
export function DistributionCard({ dist, href }: { dist: DistributionResult; href?: string }) {
  const analysis = dist.analysis;
  const fetchInfo = dist.fetch;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="format">{dist.format}</Badge>
              {statusBadge(dist.status)}
              {analysis?.score != null && (
                <span
                  className={cn('inline-flex items-center gap-1 text-sm font-semibold tabular-nums', getScoreColor(analysis.score))}
                  title="Resultado de la auditoría automatizada de esta distribución (0-100)"
                >
                  Análisis {analysis.score}%
                </span>
              )}
            </div>
            <a
              href={dist.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex max-w-full items-center gap-1 break-all text-[11px] text-link underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{dist.url}</span>
            </a>
          </div>
          <div className="text-right text-xs text-faint shrink-0 tabular-nums space-y-0.5">
            <p>{formatBytes(fetchInfo?.size ?? 0)}</p>
            <p>{formatDuration(dist.duration_ms)}</p>
            <p>{fetchInfo?.status === 'downloaded' || fetchInfo?.status === 'truncated' ? `HTTP ${fetchInfo.http_status ?? '—'}` : fetchInfo?.status ?? '—'}</p>
          </div>
        </div>

        {analysis?.summary && (
          <p className={cn('mt-3 text-sm text-body')}>{analysis.summary}</p>
        )}

        {fetchInfo?.final_url && fetchInfo.final_url !== dist.url && (
          <p className="mt-1 text-[11px] text-faint break-all">
            Redirigido a <span className="text-body">{fetchInfo.final_url}</span>
          </p>
        )}

        {fetchInfo?.note && !analysis?.summary && (
          <p className="mt-2 text-xs text-bad">{fetchInfo.note}</p>
        )}

        {analysis?.issues && analysis.issues.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {analysis.issues.map((issue) => (
              <div
                key={issue.code}
                className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {severityBadge(issue.severity)}
                  <span className="text-xs text-body">{issue.label}</span>
                </div>
                <span className="text-xs font-semibold text-faint tabular-nums shrink-0">
                  {issue.count.toLocaleString('es-ES')}
                </span>
              </div>
            ))}
          </div>
        )}

        {analysis?.metrics && Object.keys(analysis.metrics).length > 0 && <MetricsBlock metrics={analysis.metrics} />}

        {href && (
          <Link
            href={href}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-link underline-offset-2 hover:underline"
          >
            Ver ficha de la distribución
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
