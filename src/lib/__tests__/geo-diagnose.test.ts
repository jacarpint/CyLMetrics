import { describe, it, expect } from 'vitest';
import { sniff, ogcException, looksTruncatedZip, diagnose } from '../geo-diagnose';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const text = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** La respuesta literal de GeoServer para 10 de los SHP rotos del catálogo. */
const EXCEPTION_REPORT = `<?xml version="1.0" encoding="UTF-8"?><ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows" version="1.0.0">
  <ows:Exception exceptionCode="InvalidParameterValue" locator="typeName">
    <ows:ExceptionText>Feature type am:pesca_cyl_espec_v_bbass unknown</ows:ExceptionText>
  </ows:Exception>
</ows:ExceptionReport>`;

describe('sniff', () => {
  it('reconoce cada contenido por su firma', () => {
    expect(sniff(bytes(0x50, 0x4b, 0x03, 0x04))).toBe('zip');
    expect(sniff(bytes(0x1f, 0x8b, 0x08, 0x00))).toBe('gzip');
    expect(sniff(text('<?xml version="1.0"?><a/>'))).toBe('xml');
    expect(sniff(text('<!DOCTYPE HTML PUBLIC><html>'))).toBe('html');
    expect(sniff(text('{"a":1}'))).toBe('json');
    expect(sniff(bytes())).toBe('vacio');
  });

  it('no confunde una página web servida sin doctype con XML', () => {
    expect(sniff(text('<html><body>Index of /carto</body></html>'))).toBe('html');
  });
});

describe('ogcException', () => {
  it('extrae el motivo real que da el servicio', () => {
    const e = ogcException(EXCEPTION_REPORT)!;
    expect(e.code).toBe('InvalidParameterValue');
    expect(e.locator).toBe('typeName');
    expect(e.text).toBe('Feature type am:pesca_cyl_espec_v_bbass unknown');
  });

  it('entiende también el ServiceExceptionReport de WMS 1.1', () => {
    const e = ogcException('<ServiceExceptionReport><ServiceException code="LayerNotDefined">Capa desconocida</ServiceException></ServiceExceptionReport>')!;
    expect(e.text).toBe('Capa desconocida');
  });

  it('devuelve null si el XML no es un informe de error', () => {
    expect(ogcException('<WFS_Capabilities/>')).toBeNull();
  });
});

describe('looksTruncatedZip', () => {
  it('detecta que falta el directorio central', () => {
    // Un ZIP que empieza bien pero al que se le cortó el final.
    const cut = new Uint8Array(500);
    cut.set([0x50, 0x4b, 0x03, 0x04]);
    expect(looksTruncatedZip(cut.buffer)).toBe(true);
  });

  it('no marca como truncado un ZIP con su final intacto', () => {
    const whole = new Uint8Array(100);
    whole.set([0x50, 0x4b, 0x03, 0x04]);
    whole.set([0x50, 0x4b, 0x05, 0x06], 78); // EOCD en su sitio
    expect(looksTruncatedZip(whole.buffer)).toBe(false);
  });

  it('ignora lo que ni siquiera es un ZIP', () => {
    expect(looksTruncatedZip(text('<html>'))).toBe(false);
  });
});

describe('diagnose', () => {
  it('culpa al publicador cuando el servicio rechaza la petición', () => {
    const d = diagnose(text(EXCEPTION_REPORT), 'un shapefile');
    expect(d.origin).toBe('publicador');
    expect(d.detail).toContain('Feature type am:pesca_cyl_espec_v_bbass unknown');
    expect(d.detail).toContain('InvalidParameterValue');
  });

  it('reconoce el listado de directorio que sirven varios FTP del catálogo', () => {
    const d = diagnose(text('<!DOCTYPE HTML><html><title>Index of /cartografia</title>'), 'un shapefile');
    expect(d.origin).toBe('publicador');
    expect(d.reason).toContain('página web');
  });

  // Los 48 GML/KML del catálogo dan 404 con una página de error: decir que
  // «apunta a un directorio» sería describir el síntoma equivocado.
  it('antepone el código de estado a lo que parezca el contenido', () => {
    const d = diagnose(text('<!doctype html><html>Not Found</html>'), 'un archivo KML', 404);
    expect(d.reason).toContain('ya no existe');
    expect(d.reason).toContain('404');
    expect(d.origin).toBe('publicador');
  });

  it('pero un error del servicio pesa más que el código de estado', () => {
    const d = diagnose(text(EXCEPTION_REPORT), 'un shapefile', 400);
    expect(d.detail).toContain('Feature type');
  });

  it('distingue el acceso denegado del recurso inexistente', () => {
    expect(diagnose(text('x'), 'un archivo', 403).reason).toContain('deniega');
    expect(diagnose(text('x'), 'un archivo', 503).reason).toContain('falló');
  });

  it('asume la culpa cuando el ZIP llegó cortado por nuestro tope de descarga', () => {
    const cut = new Uint8Array(4096);
    cut.set([0x50, 0x4b, 0x03, 0x04]);
    const d = diagnose(cut.buffer, 'un shapefile');
    expect(d.origin).toBe('portal');
    expect(d.reason).toContain('incompleto');
  });
});
