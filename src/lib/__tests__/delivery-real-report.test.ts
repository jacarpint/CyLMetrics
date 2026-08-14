import { describe, it, expect } from 'vitest';
import { getQualityReport } from '@/lib/quality-report';
import { classifyDelivery, deliveryCause, summarizeContent, summarizeDelivery } from '@/lib/availability';
import { isBlockingCode } from '@/lib/alerts';
import { isPortalLimitation } from '@/lib/quality-labels';

/**
 * Comprobaciones sobre el informe real que hay en el repositorio.
 *
 * Los tests de `availability.test.ts` fijan la regla con casos sintéticos; estos
 * comprueban que sobre los datos de verdad la regla no vuelve a contar como
 * «no se puede abrir» un fichero que se descarga y se lee. Es el fallo que hacía
 * que el portal publicara un 35% de archivos inservibles cuando la cifra real
 * era del 16%.
 */
const report = getQualityReport();

describe.skipIf(!report)('estado de entrega sobre el informe real', () => {
  it('todo lo marcado como roto tiene un motivo que lo justifica', () => {
    const sinMotivo: string[] = [];

    for (const ds of report!.datasets) {
      for (const dist of ds.distribution_results) {
        if (classifyDelivery(dist) !== 'roto') continue;

        const codes = (dist.analysis?.issues ?? []).map((i) => i.code);
        const descargaFallida =
          dist.fetch == null || !['downloaded', 'truncated'].includes(dist.fetch.status);
        const noSeInterpreta = codes.some(isBlockingCode);

        if (!descargaFallida && !noSeInterpreta) {
          sinMotivo.push(`${dist.format} ${dist.url} (${codes.join(', ') || 'sin códigos'})`);
        }
      }
    }

    expect(sinMotivo, `Rotos sin causa bloqueante ni fallo de descarga:\n${sinMotivo.slice(0, 5).join('\n')}`).toEqual([]);
  });

  it('un fichero que se descarga y se lee no cuenta como roto', () => {
    const contradicciones: string[] = [];

    for (const ds of report!.datasets) {
      for (const dist of ds.distribution_results) {
        if (classifyDelivery(dist) !== 'roto') continue;
        const codes = (dist.analysis?.issues ?? []).map((i) => i.code);
        if (codes.some(isBlockingCode)) continue;
        const metrics = dist.analysis?.metrics ?? {};
        const filas = (metrics.rows ?? metrics.total_rows ?? metrics.features ?? metrics.records) as
          | number
          | undefined;
        if (typeof filas === 'number' && filas > 0) {
          contradicciones.push(`${dist.format} ${dist.url}: ${filas} filas leídas`);
        }
      }
    }

    expect(contradicciones, contradicciones.slice(0, 5).join('\n')).toEqual([]);
  });

  it('los estados suman el total de distribuciones', () => {
    const s = summarizeDelivery(report);
    expect(s.ok + s.roto + s.noEntrega + s.omitida + s.noAnalizado).toBe(s.total);
    expect(s.total).toBe(report!.totals.distributions);
  });

  /**
   * La cobertura del análisis, medida sobre el informe real.
   *
   * Este informe se generó en un entorno sin los lectores instalados, así que
   * trae 366 archivos que se descargaron completos y que no llegamos a abrir:
   * 341 XLSX sin openpyxl, 22 SHP sin pyshp, 1 iCal sin icalendar y 2 paquetes
   * que se cortaron por el tope de descarga. No son defectos del catálogo y no
   * pueden contarse como archivos que no abren.
   *
   * El número concreto vale para este informe y cambiará con el siguiente. Lo
   * que se fija aquí es la propiedad: nada de lo que está en `no-analizado`
   * puede tener una causa que culpe al publicador.
   */
  it('lo no analizado por falta de lector no se cuenta como roto', () => {
    const s = summarizeDelivery(report);
    expect(s.noAnalizado).toBeGreaterThan(0);

    const culpaAjena: string[] = [];
    for (const ds of report!.datasets) {
      for (const dist of ds.distribution_results) {
        if (classifyDelivery(dist) !== 'no-analizado') continue;
        // Los bytes tienen que haber llegado: si no, el estado sería otro.
        if (!['downloaded', 'truncated'].includes(dist.fetch?.status ?? '')) {
          culpaAjena.push(`${dist.format} ${dist.url}: fetch=${dist.fetch?.status}`);
        }
        const cause = deliveryCause(dist);
        // Y el motivo tiene que ser uno de los nuestros, nunca un `fetch.status`
        // crudo: devolver «downloaded» de motivo es el fallo que se veía.
        if (!cause || !isPortalLimitation(cause.code)) {
          culpaAjena.push(`${dist.format} ${dist.url}: causa=${cause?.code}`);
        }
      }
    }
    expect(culpaAjena, culpaAjena.slice(0, 5).join('\n')).toEqual([]);
  });

  /**
   * El fallo tal y como se veía en producción: la tabla de archivos enseñaba
   * «downloaded», en inglés y en minúsculas, con HTTP 200 al lado.
   */
  it('ninguna causa de entrega es un estado de descarga en crudo', () => {
    const enIngles: string[] = [];
    for (const ds of report!.datasets) {
      for (const dist of ds.distribution_results) {
        const cause = deliveryCause(dist);
        if (!cause) continue;
        if (cause.label === cause.code) {
          enIngles.push(`${dist.format} ${dist.url}: ${cause.code}`);
        }
        if (['downloaded', 'truncated'].includes(cause.code)) {
          enIngles.push(`${dist.format} ${dist.url}: motivo «${cause.code}» con la descarga correcta`);
        }
      }
    }
    expect(enIngles, enIngles.slice(0, 5).join('\n')).toEqual([]);
  });

  it('la media de contenido se calcula solo sobre lo que abre', () => {
    const content = summarizeContent(report);
    let entregadas = 0;
    for (const ds of report!.datasets) {
      for (const dist of ds.distribution_results) {
        if (classifyDelivery(dist) === 'ok') entregadas++;
      }
    }
    expect(content.scored).toBeLessThanOrEqual(entregadas);
    // `totals.avg_score` promedia también distribuciones que no se entregan, así
    // que no puede usarse donde el portal dice «no incluye los archivos rotos».
    expect(content.scored).toBeLessThan(1470);
  });
});
