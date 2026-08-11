/**
 * Allowlist de hosts para el proxy server-side.
 *
 * El proxy existe para saltar el CORS al previsualizar recursos del catálogo,
 * así que solo debe alcanzar los dominios donde la Junta publica esos recursos.
 * Sin lista sería un proxy abierto: cualquiera podría usar el servidor para
 * pedir lo que quisiera desde nuestra IP.
 *
 * Los dominios salen de los 1.655 enlaces de distribución del catálogo, todos
 * de organismos de la Junta de Castilla y León:
 *
 *   jcyl.es       1.640  datos abiertos, IDECyL, RMD y www
 *   itacyl.es        12  Instituto Tecnológico Agrario (FTP, geoportal, suelos)
 *   sigecyl.es        2  Sistema de gestión de Castilla y León
 *   inforiego.org     1  red de asesoramiento al regante, operada por el ITACyL
 *
 * La lista es explícita y no se deriva del catálogo en tiempo de ejecución a
 * propósito: si el RDF cambiara o lo manipularan, el proxy no debe ampliarse
 * solo. Cuando aparezca un host nuevo lo detecta el test `proxy-allow`, y se
 * añade aquí a mano después de comprobar de quién es.
 */

/** Dominios registrables permitidos, ellos y sus subdominios. */
export const ALLOWED_DOMAINS = [
  'jcyl.es',
  'itacyl.es',
  'sigecyl.es',
  'inforiego.org',
] as const;

export function isAllowedHost(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    // El punto del prefijo es lo que impide que «notjcyl.es» o
    // «jcyl.es.atacante.com» cuelen como subdominios.
    return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
