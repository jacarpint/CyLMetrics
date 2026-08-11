import { redirect } from "next/navigation";

/** Las tendencias viven ahora en el informe de Calidad, pestaña Evolución. */
export default function TendenciasRedirect() {
  redirect("/calidad?vista=evolucion");
}
