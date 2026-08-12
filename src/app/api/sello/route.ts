import { NextRequest, NextResponse } from "next/server";
import { getQualityReport } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import { datasetSlug } from "@/lib/utils";
import { getScoreLevel, scoreForDataset, type ScoreLevel } from "@/lib/quality";

/**
 * Colores y textos del sello.
 *
 * Los umbrales son los del portal (`getScoreLevel`: ≥80 buena, 50–79 mejorable,
 * <50 deficiente). Antes este endpoint tenía su propia escala 80/60/40, así que
 * devolvía un 60% pintado de verde mientras el resto del portal llamaba
 * «mejorable» a ese mismo 60%.
 */
const LEVEL_STYLE: Record<ScoreLevel | "unknown", { color: string; label: string }> = {
  ok: { color: "#047857", label: "Buena" },
  warn: { color: "#a45309", label: "Mejorable" },
  bad: { color: "#b91c1c", label: "Deficiente" },
  unknown: { color: "#5b6979", label: "Sin datos" },
};

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * El sello dice el nivel además del porcentaje: el color no puede ser el único
 * portador de la información (WCAG 1.4.1), y menos en una imagen que se pega en
 * webs de terceros donde nadie va a explicar la escala.
 */
function generateSVG(score: number | null): string {
  const style = score == null ? LEVEL_STYLE.unknown : LEVEL_STYLE[getScoreLevel(score)];
  const pct = score != null ? `${score}%` : "—";
  const text = `Calidad ${pct} · ${style.label}`;
  // Ancho aproximado a partir del número de caracteres, para que el texto no
  // desborde el marco con etiquetas largas como «Deficiente».
  const width = Math.max(150, 22 + text.length * 6.6);
  const height = 28;
  const { color } = style;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${height}" viewBox="0 0 ${Math.round(width)} ${height}" role="img" aria-label="${esc(text)}">
  <title>${esc(text)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${color}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.06"/>
    </linearGradient>
  </defs>
  <rect width="${Math.round(width)}" height="${height}" rx="6" fill="url(#bg)" stroke="${color}" stroke-opacity="0.3"/>
  <rect x="1" y="1" width="${Math.round(width) - 2}" height="${height - 2}" rx="5" fill="none" stroke="${color}" stroke-opacity="0.15"/>
  <text x="11" y="18" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="600" fill="${color}">${esc(text)}</text>
</svg>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("dataset");

  const report = getQualityReport();
  const catalog = await getCatalog();

  let score: number | null = null;

  if (datasetId) {
    const slug = datasetSlug(datasetId);
    const ds = report?.datasets.find((d) => d.dataset_id === datasetId || datasetSlug(d.dataset_id) === slug);
    const catalogDs = catalog.datasets.find(
      (c) => c.id === datasetId || datasetSlug(c.id) === slug
    );
    score = scoreForDataset(catalogDs?.qualityScore ?? null, ds);
  } else {
    // Media de los compuestos, no compuesto de las medias: promediar primero
    // cada eje diluye a los datasets cuyos archivos no abren.
    const bySlug = new Map((report?.datasets ?? []).map((d) => [datasetSlug(d.dataset_id), d]));
    const composites = catalog.datasets
      .map((d) => scoreForDataset(d.qualityScore, bySlug.get(datasetSlug(d.id))))
      .filter((s): s is number => s != null);
    score = composites.length > 0
      ? Math.round(composites.reduce((a, b) => a + b, 0) / composites.length)
      : null;
  }

  const svg = generateSVG(score);
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
