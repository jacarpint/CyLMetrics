import { NextRequest, NextResponse } from "next/server";
import { getQualityReport, matchDistributions } from "@/lib/quality-report";
import { getCatalog } from "@/lib/rdf-catalog";
import {
  classifyDelivery,
  datasetContentScore,
  summarizeContent,
  summarizeDelivery,
} from "@/lib/availability";
import { getScoreLevel } from "@/lib/quality";
import { distributionSlugs, resolveDistributionIndex } from "@/lib/distribution-slug";
import { datasetSlug } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("dataset");
  const publisher = searchParams.get("publisher");
  const distribucion = searchParams.get("distribucion");

  const report = getQualityReport();
  if (!report) {
    return NextResponse.json({ error: "No quality report available" }, { status: 503 });
  }

  const cacheHeaders = {
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };

  if (datasetId) {
    // Acepta la URI completa y el identificador corto (`1285663381041`), que es
    // el que usan las URLs del portal. Antes solo casaba la URI exacta.
    const slug = datasetSlug(datasetId);
    const ds = report.datasets.find(
      (d) => d.dataset_id === datasetId || datasetSlug(d.dataset_id) === slug
    );
    if (!ds) {
      return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    }

    /**
     * Un solo archivo, con `?distribucion=csv`.
     *
     * El slug es el MISMO que lleva la URL de la ficha (`/catalogo/1285.../csv-2`),
     * así que la dirección de la API se deduce de la del navegador sin tener que
     * consultar nada. Se resuelve contra el catálogo y no contra el informe,
     * porque el catálogo es quien decide qué archivos existen y en qué orden.
     */
    if (distribucion) {
      const catalog = await getCatalog();
      const catalogDs = catalog.datasets.find((d) => datasetSlug(d.id) === datasetSlug(ds.dataset_id));
      if (!catalogDs) {
        return NextResponse.json({ error: "Dataset not found in catalog" }, { status: 404 });
      }

      const formats = catalogDs.distributionUrls.map((d) => d.format);
      const idx = resolveDistributionIndex(formats, distribucion);
      const distMeta = idx >= 0 ? catalogDs.distributionUrls[idx] : undefined;
      if (!distMeta) {
        return NextResponse.json(
          { error: "Distribution not found", available: distributionSlugs(formats) },
          { status: 404 }
        );
      }

      // Emparejado por URL y no por posición, igual que la ficha.
      const dist = matchDistributions(catalogDs.distributionUrls, ds.distribution_results)[idx];
      const slug = distributionSlugs(formats)[idx];

      return NextResponse.json({
        dataset_id: ds.dataset_id,
        distribution: slug,
        format: distMeta.format,
        url: distMeta.url,
        // `null` cuando el archivo se publicó después del último análisis: es
        // «todavía no comprobado», que no es lo mismo que «sin incidencias».
        analyzed: dist != null,
        delivery: dist ? classifyDelivery(dist) : null,
        fetch: dist?.fetch ?? null,
        analysis: dist?.analysis ?? null,
      }, { headers: cacheHeaders });
    }

    return NextResponse.json({
      dataset_id: ds.dataset_id,
      title: ds.dataset_title,
      // Calculado con `classifyDelivery`, no leído del informe: el valor que
      // trae `report.py` excluye de su propia media toda distribución que el
      // analizador marcó en error, y eso es cualquiera con contenido regular.
      score: datasetContentScore(ds),
      issues_by_code: ds.issues_by_code,
      distributions: ds.distributions,
      analyzed: ds.analyzed,
      failed: ds.failed,
    }, { headers: cacheHeaders });
  }

  if (publisher) {
    // El informe de análisis no incluye el publicador; se cruza con el
    // catálogo RDF (que sí lo tiene) vía el slug numérico del dataset.
    const catalog = await getCatalog();
    const publisherBySlug = new Map<string, string>();
    for (const ds of catalog.datasets) {
      publisherBySlug.set(datasetSlug(ds.id), ds.publisher);
    }
    const needle = publisher.toLowerCase();
    const pds = report.datasets.filter((d) => {
      const pub = publisherBySlug.get(datasetSlug(d.dataset_id));
      return !!pub && pub.toLowerCase().includes(needle);
    });
    const scores = pds.map(datasetContentScore).filter((s): s is number => s != null);
    return NextResponse.json({
      publisher,
      dataset_count: pds.length,
      avg_score: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      datasets: pds.map((d) => ({
        id: d.dataset_id,
        title: d.dataset_title,
        publisher: publisherBySlug.get(datasetSlug(d.dataset_id)) ?? null,
        score: datasetContentScore(d),
      })),
    }, { headers: cacheHeaders });
  }

  const delivery = summarizeDelivery(report);

  /**
   * Reparto por niveles con los umbrales del portal (≥80 buena, 50–79
   * mejorable, <50 deficiente), no con una escala propia de 80/60/40 que no
   * coincidía con ninguna otra parte. Y los datasets sin puntuación se cuentan:
   * antes no caían en ningún cubo, así que la suma daba 436 de 824 sin decirlo.
   *
   * La nota sale de `datasetContentScore` y no del informe. Con la del informe
   * este reparto era inservible: `fair` y `poor` valían 0 **siempre**, porque
   * `report.py` excluye de la media de cada conjunto toda distribución que no
   * tenga `status == 'ok'` y ahí caen todas las que puntúan por debajo de 80.
   * Se publicaban unos umbrales («50-79», «< 50») que describían cubos
   * imposibles de llenar, y 392 conjuntos figuraban como «sin archivo legible»
   * cuando 304 de ellos sí tenían contenido medido.
   */
  const levels = { good: 0, fair: 0, poor: 0, unscored: 0 };
  const LEVEL_BUCKET = { ok: 'good', warn: 'fair', bad: 'poor' } as const;
  for (const ds of report.datasets) {
    const score = datasetContentScore(ds);
    if (score == null) levels.unscored++;
    else levels[LEVEL_BUCKET[getScoreLevel(score)]]++;
  }

  const content = summarizeContent(report);

  return NextResponse.json({
    generated_at: report.generated_at,
    totals: {
      ...report.totals,
      /**
       * Derivada, no la del informe. `report.totals.avg_score` promediaba toda
       * nota no nula —incluidas las de archivos que no abren— y daba 79,9
       * mientras la portada publicaba 90,3 para lo que dice ser lo mismo: la
       * calidad media del contenido legible. Dos cifras del mismo hecho, las dos
       * públicas. Los informes generados desde la corrección de `report.py` ya
       * traen aquí el valor bueno; esto lo garantiza también para el que esté
       * publicado ahora.
       */
      avg_score: content.avgScore,
      /** Denominador de esa media: los archivos que abren y tienen qué medir. */
      scored: content.scored,
    },
    dataset_count: report.datasets.length,
    // Disponibilidad aparte del score: son dos preguntas distintas y
    // promediarlas escondía que un tercio de los ficheros no abre.
    availability: {
      distributions: delivery.total,
      ok: delivery.ok,
      broken: delivery.roto,
      not_a_file: delivery.noEntrega,
      // `not_analyzed` sigue significando lo mismo que cuando se publicó —todo
      // lo que el análisis no llegó a comprobar— para no romper a quien ya lo
      // consuma. `no_reader` es el desglose que faltaba: de esos, cuántos
      // llegaron completos y no se miraron porque este portal no tiene lector
      // para su formato. Es una cifra sobre nosotros, no sobre el catálogo.
      not_analyzed: delivery.omitida + delivery.noAnalizado,
      no_reader: delivery.noAnalizado,
      broken_pct: delivery.brokenPct,
      affected_datasets: delivery.affectedDatasets,
    },
    // Sobre la puntuación de CONTENIDO de cada dataset. Los cuatro valores
    // suman siempre `dataset_count`.
    content_score_distribution: {
      good: levels.good,
      fair: levels.fair,
      poor: levels.poor,
      unscored: levels.unscored,
      thresholds: { good: '>= 80', fair: '50-79', poor: '< 50', unscored: 'sin archivo legible' },
    },
  }, { headers: cacheHeaders });
}
