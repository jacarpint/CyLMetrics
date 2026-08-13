/**
 * Cómo se nombra la unidad de un archivo de datos.
 *
 * Un CSV tiene filas y columnas; un JSON de registros tiene registros y campos.
 * Es el mismo dato mirado igual —el perfil, las incidencias y el recuento se
 * calculan sin enterarse—, y lo único que cambia son las palabras.
 *
 * Ese puñado de palabras estaba escrito cuatro veces, una por componente, con
 * tres nombres de clave distintos para el mismo eje: `table`/`record` en el
 * explorador de archivos y en el de tablas, `row`/`record` en el de esquema, y
 * `table`/`record`/`plain` en el de incidencias. La deriva ya había empezado: el
 * esquema decía «Columna» y la tabla «columna», así que cambiar una no cambiaba
 * la otra. Es la misma grieta por la que la periodicidad acabó llamándose
 * «Continua» en una página y «diaria» en otra.
 *
 * Aquí vive el eje entero: el tipo, las palabras y la única regla que traduce un
 * formato del catálogo a una de las dos voces.
 *
 * Client-safe: solo tablas y funciones puras.
 */

/**
 * La voz con la que el portal habla de un archivo.
 *
 * Se llamaba `IssueVoice` y vivía en `tabular-analysis.ts`, pero no tiene nada
 * que ver con las incidencias: gobierna también los encabezados del esquema, las
 * pestañas y los recuentos.
 */
export type UnitVoice = 'table' | 'record';

/**
 * Cómo enseñar las muestras de una incidencia.
 *
 * Es el mismo eje más un tercer estado: en XML, KML o shapefile no hay filas ni
 * registros planos, y forzar una cuadrícula inventa una estructura que el
 * archivo no tiene. Se define a partir de `UnitVoice` en vez de repetir sus dos
 * miembros, para que añadir una voz no obligue a acordarse de este tipo.
 */
export type IssuePresentation = UnitVoice | 'plain';

export interface UnitWords {
  /** Lo que se cuenta hacia abajo, en singular: «fila 42». */
  row: string;
  /** Lo que se cuenta hacia abajo, en plural: «200 filas». */
  rows: string;
  /** Lo que se cuenta a lo ancho, en singular: «· columna Municipio». */
  col: string;
  /** Lo que se cuenta a lo ancho, en plural: pestaña «Columnas». */
  cols: string;
}

/**
 * Todo en minúscula: casi todos los usos intercalan la palabra en una frase, y
 * los tres que la necesitan en mayúscula la piden con `capitalize`. Guardar las
 * dos versiones era justo lo que dejó que «Columna» y «columna» se separaran.
 *
 * De las tablas viejas no se ha traído el titular de la muestra
 * («Vista previa de datos» / «Registros de ejemplo»): estaba definido en el
 * explorador de esquema y no lo leía nadie.
 */
const WORDS: Record<UnitVoice, UnitWords> = {
  table: { row: 'fila', rows: 'filas', col: 'columna', cols: 'columnas' },
  record: { row: 'registro', rows: 'registros', col: 'campo', cols: 'campos' },
};

export function unitWords(voice: UnitVoice): UnitWords {
  return WORDS[voice];
}

/** Primera letra en mayúscula, para cuando la palabra abre frase o rótulo. */
export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Qué voz le corresponde a un formato del catálogo.
 *
 * Los formatos que no son ni tabla ni lista de registros caen en `plain`: es
 * más honesto que enseñarles una cuadrícula vacía.
 */
export function presentationForFormat(format?: string): IssuePresentation {
  switch ((format ?? '').toUpperCase()) {
    case 'CSV':
    case 'TSV':
    case 'XLSX':
    case 'XLS':
    case 'TXT':
      return 'table';
    case 'JSON':
    case 'GEOJSON':
      return 'record';
    default:
      return 'plain';
  }
}
