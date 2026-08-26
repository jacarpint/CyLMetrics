import { describe, it, expect, vi, afterEach } from 'vitest';
import { followUpstream } from '@/app/api/proxy/route';

/**
 * Las redirecciones del proxy, comprobadas por lo que PIDE y no solo por lo que
 * devuelve.
 *
 * Con `redirect: "follow"` la allowlist llegaba tarde: se miraba `response.url`
 * cuando la petición al destino ya se había hecho desde el servidor. Devolver un
 * 400 después no arregla nada, porque la peticion en sí es la vulnerabilidad —
 * alcanza cosas a las que solo llega el servidor, y el tiempo de respuesta las
 * delata—.
 *
 * Por eso estos tests cuentan las llamadas a `fetch`: la afirmación que importa
 * no es «responde 400», es «no llegó a pedirlo».
 */

const PERMITIDO = 'https://datosabiertos.jcyl.es/x.csv';

/** Un 3xx con su `Location`. */
function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** Encadena las respuestas que devolverá `fetch`, en orden, y registra las URL. */
function stubFetch(...responses: Response[]) {
  const urls: string[] = [];
  const fake = vi.fn(async (input: string | URL) => {
    urls.push(String(input));
    return responses[urls.length - 1] ?? new Response('fin', { status: 200 });
  });
  vi.stubGlobal('fetch', fake);
  return { urls, fake };
}

const señal = () => new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('followUpstream', () => {
  it('no pide el destino cuando la redirección sale de los dominios permitidos', async () => {
    const { urls } = stubFetch(redirect('https://evil.example/robado'));

    const result = await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect('error' in result).toBe(true);
    // Lo esencial: UNA sola petición, la permitida. El destino nunca se pidió.
    expect(urls).toEqual([PERMITIDO]);
  });

  it('tampoco pide una dirección interna', async () => {
    // El objetivo clásico de un SSRF: el servicio de metadatos de la nube.
    for (const destino of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8080/admin',
      'http://10.0.0.5/interno',
    ]) {
      const { urls } = stubFetch(redirect(destino));
      const result = await followUpstream(PERMITIDO, 'GET', {}, señal());
      expect('error' in result, destino).toBe(true);
      expect(urls, destino).toEqual([PERMITIDO]);
      vi.unstubAllGlobals();
    }
  });

  it('sigue la redirección cuando el destino también está permitido', async () => {
    // El caso real del catálogo: `datosabiertos.jcyl.es` redirige a
    // `transparencia.jcyl.es`, y los dos son de la Junta.
    const destino = 'https://transparencia.jcyl.es/educacion/x.csv';
    const { urls } = stubFetch(redirect(destino), new Response('datos', { status: 200 }));

    const result = await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect('response' in result).toBe(true);
    expect(urls).toEqual([PERMITIDO, destino]);
  });

  it('resuelve un `Location` relativo contra el salto actual', async () => {
    const { urls } = stubFetch(redirect('/otra/ruta.csv'), new Response('datos', { status: 200 }));

    await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect(urls[1]).toBe('https://datosabiertos.jcyl.es/otra/ruta.csv');
  });

  it('corta una cadena de redirecciones que no acaba', async () => {
    // Sin tope, un servidor que se redirige a sí mismo secuestra la función
    // hasta que la plataforma la mata.
    const { urls } = stubFetch(...Array.from({ length: 20 }, () => redirect(PERMITIDO)));

    const result = await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect('error' in result).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(6); // MAX_REDIRECTS + la primera
  });

  it('devuelve la respuesta sin tocar cuando no hay redirección', async () => {
    const { urls } = stubFetch(new Response('datos', { status: 200 }));

    const result = await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect('response' in result).toBe(true);
    expect(urls).toEqual([PERMITIDO]);
  });

  it('un 3xx sin `Location` se devuelve tal cual, no se inventa un salto', async () => {
    const { urls } = stubFetch(new Response(null, { status: 302 }));

    const result = await followUpstream(PERMITIDO, 'GET', {}, señal());

    expect('response' in result).toBe(true);
    expect(urls).toEqual([PERMITIDO]);
  });

  it('un 206 no es una redirección: es la respuesta a un `Range`', async () => {
    const { urls } = stubFetch(new Response('tramo', { status: 206 }));

    const result = await followUpstream(PERMITIDO, 'GET', { range: 'bytes=0-99' }, señal());

    expect('response' in result).toBe(true);
    expect(urls).toEqual([PERMITIDO]);
  });
});
