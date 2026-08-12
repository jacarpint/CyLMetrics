import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/rdf-catalog";
import { distributionSlugs } from "@/lib/distribution-slug";
import { datasetSlug } from "@/lib/utils";

/**
 * Sitemap del portal.
 *
 * Sin esto, las ~825 fichas de dataset y sus ~1.650 distribuciones solo eran
 * alcanzables navegando y paginando el catálogo, así que quedaban prácticamente
 * fuera del índice de los buscadores.
 *
 * `SITE_URL` la fija el despliegue; en local cae a localhost.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/catalogo`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/calidad`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/metodologia`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];

  const datasetPages: MetadataRoute.Sitemap = catalog.datasets.flatMap((ds) => {
    const slug = datasetSlug(ds.id);
    const lastModified = ds.modified ?? ds.lastUpdated;
    const parsed = lastModified ? new Date(lastModified) : null;
    const when = parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
    const slugs = distributionSlugs(ds.distributionUrls.map((d) => d.format));

    return [
      { url: `${SITE_URL}/catalogo/${slug}`, lastModified: when, changeFrequency: "weekly" as const, priority: 0.7 },
      ...slugs.map((distSlug) => ({
        url: `${SITE_URL}/catalogo/${slug}/${distSlug}`,
        lastModified: when,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })),
    ];
  });

  return [...staticPages, ...datasetPages];
}
