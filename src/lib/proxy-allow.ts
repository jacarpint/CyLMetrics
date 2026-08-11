/**
 * Allowlist de hosts para el proxy server-side. Solo permitimos recursos del
 * dominio de datos abiertos de la Junta (y sus subdominios), para no convertir
 * el endpoint en un proxy abierto.
 */
export function isAllowedHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return host === "jcyl.es" || host.endsWith(".jcyl.es");
  } catch {
    return false;
  }
}
