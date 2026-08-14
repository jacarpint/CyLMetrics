import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUE_LABELS, PORTAL_LIMITATION_CODES } from '@/lib/quality-labels';

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
    for (const modulo of ['frictionless', 'openpyxl', 'shapefile', 'icalendar', 'geojson', 'PIL']) {
      expect(tabla, modulo).toContain(`"${modulo}"`);
    }
  });
});
