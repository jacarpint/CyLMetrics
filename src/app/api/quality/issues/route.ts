import { NextRequest, NextResponse } from "next/server";
import { getDistributionDetail } from "@/lib/quality-report";
import { affectedColumns, issuePositions, positionCount } from "@/lib/report-bundle";

/**
 * Posiciones de una incidencia dentro de un archivo, por páginas.
 *
 * Existe porque el informe ya no guarda cinco muestras por incidencia sino
 * todas: una distribución puede traer cientos de miles de posiciones y bajarlas
 * enteras para pintar cincuenta es lo que congelaba el visor. El fragmento se
 * lee en el servidor y solo viaja el tramo pedido.
 *
 * GET /api/quality/issues?dist=<id>                       -> resumen por código
 * GET /api/quality/issues?dist=<id>&code=<code>&offset=&limit=  -> posiciones
 *
 * `<id>` es el que trae cada distribución del informe (`DistributionResult.id`).
 */

/** Tope por petición: la interfaz pide 50 y esto solo acota un `limit` a mano. */
const MAX_LIMIT = 500;

export const revalidate = 3600;

function parseInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const distId = searchParams.get("dist");
  const code = searchParams.get("code");

  if (!distId) {
    return NextResponse.json({ error: "Falta el parámetro 'dist'" }, { status: 400 });
  }

  // `getDistributionDetail` valida la forma del id antes de tocar el disco.
  const detail = getDistributionDetail(distId);
  if (!detail) {
    return NextResponse.json({ error: "No hay detalle para ese recurso" }, { status: 404 });
  }

  // El informe es una foto inmutable: una vez publicado, un fragmento no
  // cambia. Por eso `immutable` y no los 5 minutos del resto de la API.
  const headers = { "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable" };

  if (!code) {
    return NextResponse.json(
      {
        id: detail.id,
        url: detail.url,
        format: detail.format,
        header: detail.header,
        issues: detail.issues.map((issue) => ({
          code: issue.code,
          label: issue.label,
          severity: issue.severity,
          count: issue.count,
          stored: issue.stored,
          positions: positionCount(issue),
          columns: affectedColumns(issue),
        })),
      },
      { headers }
    );
  }

  const issue = detail.issues.find((i) => i.code === code);
  if (!issue) {
    return NextResponse.json({ error: "Ese recurso no tiene esa incidencia" }, { status: 404 });
  }

  const offset = parseInteger(searchParams.get("offset"), 0);
  const limit = Math.min(parseInteger(searchParams.get("limit"), 50) || 50, MAX_LIMIT);

  return NextResponse.json(
    {
      code: issue.code,
      severity: issue.severity,
      /** Ocurrencias detectadas por el analizador. */
      count: issue.count,
      /** Posiciones disponibles. Menor que `count` si se recortaron. */
      total: positionCount(issue),
      offset,
      positions: issuePositions(issue, offset, limit),
    },
    { headers }
  );
}
