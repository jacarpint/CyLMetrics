import { redirect } from "next/navigation";

/** La transparencia por organización vive ahora en Calidad, pestaña Organismos. */
export default function TransparenciaRedirect() {
  redirect("/calidad?vista=organismos");
}
