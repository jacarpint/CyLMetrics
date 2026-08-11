import { redirect } from "next/navigation";

/** Las alertas viven ahora dentro del informe de Calidad, pestaña Incidencias. */
export default function AlertasRedirect() {
  redirect("/calidad?vista=incidencias");
}
