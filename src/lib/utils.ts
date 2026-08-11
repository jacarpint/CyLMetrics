import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Clave URL amigable de un dataset a partir de su URI (rdf:about / dataset_id).
 * Los ids de jcyl terminan en un número único del catálogo (p. ej.
 * "https://datosabiertos.jcyl.es/web/jcyl/set/es/.../1285607834534" ->
 * "1285607834534"). Si no hay número, devuelve la URI codificada.
 */
export function datasetSlug(id: string): string {
  const match = id.replace(/\/+$/, '').match(/(\d+)$/);
  return match ? match[1] : encodeURIComponent(id);
}
