import { redirect } from "next/navigation";

/** La calidad geoespacial vive ahora dentro del Catálogo (vista de mapa + filtro geoespacial). */
export default function GisRedirect() {
  redirect("/catalogo?geo=1&vista=mapa");
}
