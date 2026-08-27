import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUE_LABELS, PORTAL_LIMITATION_CODES } from '@/lib/quality-labels';
import { BLOCKING_ISSUE_CODES } from '@/lib/alerts';

/**
 * Las listas que tienen que decir lo mismo a los dos lados.
 *
 * El analizador es Python y la interfaz TypeScript, y entre los dos hay tablas
 * que se mantienen a mano (lo dice la cabecera de `quality-labels.ts`). Cuando se
 * desincronizan no falla nada: simplemente el portal empieza a clasificar mal, y
 * eso solo se ve mirando el informe con cuidado. Fue así como 364 incidencias que
 * hablaban de nosotros —lectores que no teníamos instalados— se publicaron
 * durante días como defectos de los datos del catálogo.
 *
 * Estos tests leen el fuente de Python. Es tosco, y es mucho mejor que descubrirlo
 * en producción. Hay precedente de tests que leen ficheros reales del proyecto:
 * `delivery-real-report.test.ts` afirma sobre el informe publicado.
 */
const ANALYSIS_DIR = path.join(process.cwd(), 'src', 'analysis');

/** Los fuentes se leen una vez: son los mismos para todos los `it`. */
const CHECKS_PY = fs.readFileSync(path.join(ANALYSIS_DIR, 'checks.py'), 'utf-8');
const DOWNLOADER_PY = fs.readFileSync(path.join(ANALYSIS_DIR, 'downloader.py'), 'utf-8');

/**
 * Los literales de cadena de una colección de Python: `NOMBRE = frozenset({…})`,
 * `NOMBRE = (…)`, `NOMBRE = […]`. Un solo lector para las tres formas, porque
 * tener uno por tipo de paréntesis es cómo se acaba comprobando solo una.
 */
function pythonStrings(source: string, name: string): string[] {
  const match = new RegExp(`${name}\\s*=\\s*\\w*\\s*[({[]([\\s\\S]*?)[)}\\]]`).exec(source);
  if (!match) throw new Error(`No se encuentra ${name} en el fuente de Python`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

describe('paridad de PORTAL_LIMITATION_CODES entre Python y TypeScript', () => {
  it('las dos listas contienen exactamente los mismos códigos', () => {
    const fromPython = pythonStrings(CHECKS_PY, 'PORTAL_LIMITATION_CODES');
    expect(fromPython.sort()).toEqual([...PORTAL_LIMITATION_CODES].sort());
  });

  /**
   * El otro conjunto que cruza la frontera: los defectos de publicación, que en
   * TypeScript se llaman `NOT_A_FILE_CODES` y en Python `PUBLICATION_DEFECT_CODES`.
   * `engine.py` los usa junto a los del portal para no penalizar al organismo, así
   * que si los dos lados dejan de coincidir la clasificación se parte igual que se
   * partió con los lectores que faltaban.
   */
  it('los defectos de publicación también coinciden a los dos lados', () => {
    const fromPython = pythonStrings(CHECKS_PY, 'PUBLICATION_DEFECT_CODES').sort();
    expect(fromPython).toEqual(['no-es-archivo', 'no-es-imagen']);
    for (const code of fromPython) {
      // Y no pueden estar en los dos conjuntos: son conceptos distintos.
      expect(PORTAL_LIMITATION_CODES.has(code), code).toBe(false);
    }
  });

  it('todos tienen etiqueta en español, que es para lo que se clasifican', () => {
    for (const code of PORTAL_LIMITATION_CODES) {
      expect(ISSUE_LABELS[code], code).toBeTruthy();
    }
  });

  /**
   * Un defecto de publicación no puede colarse en la lista: `no-es-archivo` y
   * `no-es-imagen` significan que la URL publicada devuelve una página web en vez
   * del archivo, y eso sí es del catálogo. `engine.py` los trata aparte a
   * propósito, y si alguien los moviera aquí dejarían de contarse.
   */
  it('no incluye defectos que sí son del publicador', () => {
    expect(PORTAL_LIMITATION_CODES.has('no-es-archivo')).toBe(false);
    expect(PORTAL_LIMITATION_CODES.has('no-es-imagen')).toBe(false);
    expect(PORTAL_LIMITATION_CODES.has('descarga')).toBe(false);
  });
});

/**
 * El tercer conjunto que cruza la frontera.
 *
 * `report.py` lo necesita para no meter en la media de calidad de contenido los
 * archivos que ni siquiera abren: un JSON inválido no tiene contenido que medir
 * y su cero pertenece al eje de disponibilidad. Mientras no lo tuvo, la media de
 * cada conjunto se calculaba con `status == 'ok'` a secas y descartaba de paso
 * TODAS las notas por debajo de 80.
 */
describe('paridad de BLOCKING_ISSUE_CODES entre Python y TypeScript', () => {
  it('las dos listas contienen exactamente los mismos códigos', () => {
    const fromPython = pythonStrings(CHECKS_PY, 'BLOCKING_ISSUE_CODES');
    expect(fromPython.sort()).toEqual([...BLOCKING_ISSUE_CODES].sort());
  });

  it('todos tienen etiqueta en español', () => {
    for (const code of BLOCKING_ISSUE_CODES) {
      expect(ISSUE_LABELS[code], code).toBeTruthy();
    }
  });

  /**
   * Los dos defectos de publicación sí están aquí, y no es una contradicción con
   * el test de arriba: que la URL devuelva una página web no es una limitación
   * NUESTRA (por eso no está en `PORTAL_LIMITATION_CODES`), pero desde luego
   * impide abrir el archivo, así que su nota tampoco puede entrar en la media.
   */
  it('incluye los defectos de publicación, que también impiden abrir', () => {
    expect(BLOCKING_ISSUE_CODES.has('no-es-archivo')).toBe(true);
    expect(BLOCKING_ISSUE_CODES.has('no-es-imagen')).toBe(true);
  });

  /**
   * Un problema de contenido no puede colarse aquí: si «tipos mezclados en una
   * columna» pasara a ser bloqueante, el archivo saldría de la media de
   * contenido y volveríamos justo al fallo que esto corrige.
   */
  it('no incluye incidencias de contenido, que sí se miden', () => {
    for (const code of ['error-tipo', 'celda-faltante', 'encabezado-vacio', 'fila-duplicada']) {
      expect(BLOCKING_ISSUE_CODES.has(code), code).toBe(false);
    }
  });
});

describe('paridad de los estados de descarga', () => {
  /**
   * `deliveryCause` puede caer a un `fetch.status` cuando la descarga falla, y en
   * ese momento el valor se usa como código de incidencia. Si alguno no tiene
   * etiqueta, sale en la interfaz en inglés y en minúsculas: es exactamente lo que
   * se veía en la tabla de archivos, con «downloaded» de motivo.
   */
  it('los ocho estados de Python tienen etiqueta en la interfaz', () => {
    const estados = pythonStrings(DOWNLOADER_PY, 'FETCH_STATUSES');
    expect(estados).toHaveLength(8);
    const sinEtiqueta = estados.filter((s) => !ISSUE_LABELS[s]);
    expect(sinEtiqueta, `Estados sin etiqueta: ${sinEtiqueta.join(', ')}`).toEqual([]);
  });

  it('ninguna etiqueta de estado es el propio código', () => {
    for (const estado of ['downloaded', 'truncated', 'no_url', 'error', 'too_large']) {
      expect(ISSUE_LABELS[estado], estado).not.toBe(estado);
    }
  });
});

describe('los analizadores no puntúan lo que no han medido', () => {
  /**
   * Cinco analizadores devolvían `score: 0` al no encontrar su librería, y
   * `report.py` mete en las medias toda nota no nula: de ahí el `XLSX: avg_score 0`
   * del informe. Con `None` se quedan fuera solos, sin capa de corrección.
   *
   * La comprobación es sobre el texto del fuente, que es tosco, pero es lo único
   * que puede afirmar algo del analizador desde aquí: no hay intérprete de Python
   * en el entorno de estos tests.
   */
  it('ninguno construye la incidencia a mano ni devuelve una nota', () => {
    const modulos = ['excel.py', 'shapefile.py', 'ical.py', 'geo.py', 'images.py'];
    const mal: string[] = [];
    for (const modulo of modulos) {
      const fuente = fs.readFileSync(path.join(ANALYSIS_DIR, 'formats', modulo), 'utf-8');
      // Tiene que delegar en el constructor común.
      if (!fuente.includes('missing_dependency_issue')) mal.push(`${modulo} (no delega)`);
      // Y no volver a escribir el dict, que es como se colaba `severity: error`.
      if (fuente.includes('"code": "dependencia-faltante"')) mal.push(`${modulo} (dict a mano)`);
    }
    expect(mal, mal.join(', ')).toEqual([]);
  });

  it('el único constructor pone severidad informativa', () => {
    expect(CHECKS_PY).toContain('def missing_dependency_issue');
    expect(CHECKS_PY).toMatch(/simple_issue\([^)]*"info"\)/);
  });

  /**
   * La comprobación previa tiene que cubrir todos los formatos, no solo los que
   * fallaron aquella vez. `frictionless` es el que más importa —valida CSV, TXT y
   * JSON, casi 1.000 de las 1.658 distribuciones— y se quedó fuera de la primera
   * versión de la tabla.
   */
  it('la comprobación previa cubre el lector de CSV y JSON', () => {
    const formats = fs.readFileSync(path.join(ANALYSIS_DIR, 'formats', '__init__.py'), 'utf-8');
    const tabla = /READER_REQUIREMENTS[\s\S]*?\n}/.exec(formats)?.[0] ?? '';
    // `xlrd` está en la lista por el mismo motivo que openpyxl: llega solo por
    // vía transitiva de `frictionless[excel]`, y `excel.py` decide por magic
    // bytes, así que un archivo declarado XLSX que sea un OLE2 de Excel 97-2003
    // acaba en él. El catálogo no tiene ninguno hoy, y por eso su ausencia no se
    // notaría hasta el día que lo tenga.
    for (const modulo of ['frictionless', 'openpyxl', 'xlrd', 'shapefile', 'icalendar', 'geojson', 'PIL']) {
      expect(tabla, modulo).toContain(`"${modulo}"`);
    }
  });
});
