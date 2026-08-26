import { describe, it, expect } from 'vitest';
import { safeEndpoint } from '@/app/api/ogc/route';

/**
 * El endpoint que `/api/ogc` devuelve al navegador.
 *
 * Sale del `<OnlineResource xlink:href>` del documento de capacidades, o sea de
 * contenido remoto, y llega hasta `L.tileLayer.wms()` y el `<img>` de la
 * leyenda. Salía sin comprobar contra la allowlist.
 */

/** La URL de la que se descargaron las capacidades: ya comprobada. */
const FINAL = 'https://idecyl.jcyl.es/geoserver/incendios/ows?service=WMS&request=GetCapabilities';

describe('safeEndpoint', () => {
  it('acepta el href que declara el servicio si está en la allowlist', () => {
    expect(safeEndpoint('https://idecyl.jcyl.es/geoserver/incendios/ows?', FINAL)).toBe(
      'https://idecyl.jcyl.es/geoserver/incendios/ows'
    );
  });

  it('quita los parámetros que el cliente pone por su cuenta', () => {
    // GeoServer publica hrefs del tipo `…/ows?SERVICE=WMS&`. Sin limpiarlos,
    // Leaflet concatena y sale `…?SERVICE=WMS&&service=WMS&…`.
    expect(
      safeEndpoint('https://idecyl.jcyl.es/geoserver/ows?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0', FINAL)
    ).toBe('https://idecyl.jcyl.es/geoserver/ows');
  });

  it('conserva los parámetros que el servicio necesita', () => {
    // `map=` de MapServer es imprescindible: recortar a la ruta pelada lo rompe.
    expect(safeEndpoint('https://idecyl.jcyl.es/cgi-bin/mapserv?map=/etc/x.map&service=WMS', FINAL)).toBe(
      'https://idecyl.jcyl.es/cgi-bin/mapserv?map=%2Fetc%2Fx.map'
    );
  });

  it('descarta un href a un dominio ajeno y usa la URL comprobada', () => {
    expect(safeEndpoint('https://evil.example/geoserver/ows', FINAL)).toBe(
      'https://idecyl.jcyl.es/geoserver/incendios/ows'
    );
  });

  it('descarta un href al localhost de quien visita el portal', () => {
    // El caso probable, y no es un ataque: un GeoServer detrás de un proxy
    // inverso que anuncia su dirección interna. El navegador acabaría pidiendo
    // las teselas a SU PROPIO localhost.
    expect(safeEndpoint('http://localhost:8080/geoserver/ows', FINAL)).toBe(
      'https://idecyl.jcyl.es/geoserver/incendios/ows'
    );
    expect(safeEndpoint('http://10.0.0.5/geoserver/ows', FINAL)).toBe(
      'https://idecyl.jcyl.es/geoserver/incendios/ows'
    );
  });

  it('descarta un href que no es http ni https', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
      expect(safeEndpoint(href, FINAL), href).toBe('https://idecyl.jcyl.es/geoserver/incendios/ows');
    }
  });

  it('no se deja engañar por un dominio que solo empieza igual', () => {
    expect(safeEndpoint('https://jcyl.es.atacante.com/ows', FINAL)).toBe(
      'https://idecyl.jcyl.es/geoserver/incendios/ows'
    );
  });

  it('sin href, usa la URL de la que vinieron las capacidades', () => {
    expect(safeEndpoint('', FINAL)).toBe('https://idecyl.jcyl.es/geoserver/incendios/ows');
  });

  it('resuelve un href relativo contra esa misma URL', () => {
    expect(safeEndpoint('/geoserver/otro/ows', FINAL)).toBe('https://idecyl.jcyl.es/geoserver/otro/ows');
  });
});
