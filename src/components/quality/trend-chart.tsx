import type { HistoryPoint } from '@/lib/quality-history';
import { getScoreStroke } from '@/lib/quality';

/**
 * Gráficos SVG autocontenidos (sin dependencias) para la evolución de calidad.
 * Componentes de servidor: renderizan SVG puro, sin hooks.
 *
 * Los colores salen de variables CSS (`var(--…)`) en lugar de hexadecimales
 * fijos, así que el gráfico voltea con el tema sin volver a renderizarse. Se
 * aplican por `style` y no como atributo de presentación, que es donde `var()`
 * tiene soporte garantizado.
 */

interface TrendLineProps {
  labels: string[];
  values: (number | null)[];
  color?: string;
  height?: number;
}

/** Línea de tendencia de una serie de scores globales. */
export function TrendLine({ labels, values, color = 'var(--ok-solid)', height = 220 }: TrendLineProps) {
  const width = 640;
  const padX = 28;
  const padTop = 16;
  const padBottom = 30;

  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) {
    return <p className="text-sm text-faint">Sin datos suficientes para la evolución.</p>;
  }

  const min = Math.min(0, ...valid.map((v) => Math.max(0, Math.floor(v / 10) * 10)));
  const max = Math.max(100, ...valid.map((v) => Math.min(100, Math.ceil(v / 10) * 10)));

  const xFor = (i: number) => padX + (i * (width - padX * 2)) / Math.max(1, values.length - 1);
  const yFor = (v: number) => padTop + ((max - v) / (max - min)) * (height - padTop - padBottom);

  const pts = values
    .map((v, i) => (v != null ? { x: xFor(i), y: yFor(v), v } : null))
    .filter((p): p is { x: number; y: number; v: number } => p != null);

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${height - padBottom} L${pts[0].x.toFixed(1)},${height - padBottom} Z`;

  const gridVals = [min, (min + max) / 2, max];
  const first = valid[0];
  const last = valid[valid.length - 1];
  const delta = Math.round(last - first);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={
        `Evolución del score medio: de ${Math.round(first)} a ${Math.round(last)} sobre 100` +
        (delta === 0 ? ', sin cambio' : delta > 0 ? `, ${delta} puntos más` : `, ${Math.abs(delta)} puntos menos`)
      }
    >
      {gridVals.map((gv) => (
        <g key={gv}>
          <line
            x1={padX}
            x2={width - padX}
            y1={yFor(gv)}
            y2={yFor(gv)}
            strokeWidth={1}
            style={{ stroke: 'var(--border)' }}
          />
          <text x={padX - 6} y={yFor(gv) + 3} fontSize={10} textAnchor="end" style={{ fill: 'var(--faint)' }}>
            {gv}
          </text>
        </g>
      ))}

      <path d={areaPath} fillOpacity={0.12} style={{ fill: color }} />
      <path d={linePath} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />

      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} strokeWidth={1.5} style={{ fill: color, stroke: 'var(--card)' }} />
      ))}

      {labels.map((label, i) =>
        label ? (
          <text key={label + i} x={xFor(i)} y={height - 8} fontSize={10} textAnchor="middle" style={{ fill: 'var(--faint)' }}>
            {label}
          </text>
        ) : null
      )}
    </svg>
  );
}

interface SparklineProps {
  points: HistoryPoint[];
  width?: number;
  height?: number;
}

/** Mini-línea de evolución del score de un dataset. */
export function Sparkline({ points, width = 130, height = 32 }: SparklineProps) {
  if (points.length === 0) return <span className="text-[10px] text-faint">—</span>;

  const pad = 2;
  const xFor = (i: number) => pad + (i * (width - pad * 2)) / Math.max(1, points.length - 1);
  const yFor = (v: number) => pad + ((100 - v) / 100) * (height - pad * 2);

  const last = points[points.length - 1].score;
  const color = getScoreStroke(last);

  if (points.length === 1) {
    return (
      <svg width={width} height={height} className="shrink-0" aria-hidden="true">
        <circle cx={width / 2} cy={yFor(points[0].score)} r={3} style={{ fill: color }} />
      </svg>
    );
  }

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.score).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <path d={path} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: color }} />
      {points.map((p, i) => (
        <circle key={i} cx={xFor(i)} cy={yFor(p.score)} r={2} style={{ fill: color }} />
      ))}
    </svg>
  );
}
