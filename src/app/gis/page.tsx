import { redirect } from "next/navigation";

/** La calidad geoespacial vive ahora dentro del Catálogo, tras su filtro propio. */
export default function GisRedirect() {
  redirect("/catalogo?geo=1");
}
