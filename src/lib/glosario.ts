/**
 * El vocabulario del portal, en un solo sitio.
 *
 * Un portal sobre calidad de datos abiertos habla necesariamente de conjuntos de
 * datos, distribuciones, DCAT o licencias abiertas. Eso no se puede evitar sin
 * dejar de ser preciso; lo que sí se puede es no dar por sabido nada. Cada
 * término se define aquí una vez y la página `/glosario` los publica con un
 * ancla estable, para poder enlazar la primera mención desde cualquier vista.
 *
 * Client-safe: sin imports de servidor.
 */

export interface GlossaryTerm {
  /** Ancla de la URL: `/glosario#conjunto-de-datos`. */
  id: string;
  term: string;
  /** Cómo se dice también, para que quien venga de otro portal se reconozca. */
  aka?: string;
  /** La definición, sin usar otros términos del glosario sin enlazarlos. */
  definition: string;
  /** Por qué aparece en este portal y dónde se ve. */
  inPortal?: string;
  group: 'datos' | 'calidad' | 'formatos';
}

export const GLOSSARY_GROUPS: { id: GlossaryTerm['group']; label: string; intro: string }[] = [
  {
    id: 'datos',
    label: 'Los datos y su catálogo',
    intro: 'Cómo se organiza lo que publica la Junta y con qué palabras se nombra.',
  },
  {
    id: 'calidad',
    label: 'Cómo se mide la calidad',
    intro: 'Las tres dimensiones que evalúa el portal y cómo se combinan en una nota.',
  },
  {
    id: 'formatos',
    label: 'Formatos y servicios',
    intro: 'Los tipos de archivo que aparecen en el catálogo, y qué se puede hacer con cada uno.',
  },
];

export const GLOSSARY: GlossaryTerm[] = [
  /* ── Los datos y su catálogo ── */
  {
    id: 'conjunto-de-datos',
    term: 'Conjunto de datos',
    aka: 'dataset',
    group: 'datos',
    definition:
      'Una publicación con entidad propia: «Centros educativos de Castilla y León», «Presupuestos de 2024». Es la unidad que se busca, se cita y se enlaza.',
    inPortal:
      'Cada conjunto de datos tiene su ficha en el catálogo, con sus metadatos, sus archivos y su índice de calidad.',
  },
  {
    id: 'archivo',
    term: 'Archivo',
    aka: 'distribución',
    group: 'datos',
    definition:
      'Cada una de las descargas concretas de un conjunto de datos. Un mismo conjunto suele publicarse en varios formatos —CSV, Excel, JSON— y cada uno es un archivo distinto, con su propia dirección de descarga.',
    inPortal:
      'El portal comprueba archivo por archivo, no conjunto por conjunto: es habitual que el CSV de un conjunto abra y su shapefile no.',
  },
  {
    id: 'metadatos',
    term: 'Metadatos',
    group: 'datos',
    definition:
      'La ficha que describe un conjunto de datos sin ser los datos en sí: título, descripción, quién lo publica, con qué licencia, cada cuánto se actualiza y qué territorio cubre.',
    inPortal:
      'Son el 40% del índice de calidad. Son también lo más barato de corregir, porque se editan sin tocar los datos.',
  },
  {
    id: 'catalogo',
    term: 'Catálogo',
    group: 'datos',
    definition:
      'El inventario completo de lo que una administración publica en abierto. El de Castilla y León vive en datosabiertos.jcyl.es.',
  },
  {
    id: 'dcat',
    term: 'DCAT',
    group: 'datos',
    definition:
      'El estándar europeo con el que las administraciones describen sus catálogos de datos para que se entiendan entre sí. Gracias a él, un programa puede leer el catálogo de Castilla y León igual que el de cualquier otra región.',
    inPortal:
      'Es de donde el portal lee los metadatos. Cuando aparece un nombre como dct:modified, es el nombre exacto del campo dentro de ese estándar.',
  },
  {
    id: 'licencia-abierta',
    term: 'Licencia abierta',
    group: 'datos',
    definition:
      'El permiso que acompaña al dato y dice qué se puede hacer con él. La más abierta de las que usa el catálogo es CC-BY-4.0, que solo pide citar la fuente; otras excluyen el uso comercial.',
    inPortal:
      'Sin una licencia identificable, mucha gente no reutiliza el dato aunque técnicamente pueda: ante la duda, no se usa.',
  },
  {
    id: 'reutilizacion',
    term: 'Reutilización',
    group: 'datos',
    definition:
      'Usar un dato público para algo distinto de aquello para lo que se recogió: una aplicación, un estudio, un reportaje, un producto. Es la razón de ser de los datos abiertos.',
  },
  {
    id: 'periodicidad',
    term: 'Periodicidad',
    group: 'datos',
    definition:
      'Cada cuánto se compromete el organismo a actualizar un conjunto de datos: mensual, trimestral, anual. Sin ella no hay forma de saber si un dato de hace ocho meses va con retraso o es justo lo esperado.',
  },

  /* ── Cómo se mide la calidad ── */
  {
    id: 'indice-de-calidad',
    term: 'Índice de calidad',
    group: 'calidad',
    definition:
      'La nota de 0 a 100 de un conjunto de datos. Combina las tres dimensiones: 40% metadatos, 30% disponibilidad y 30% contenido.',
    inPortal: 'Es el círculo que aparece en cada tarjeta del catálogo y en la cabecera de cada ficha.',
  },
  {
    id: 'disponibilidad',
    term: 'Disponibilidad',
    group: 'calidad',
    definition:
      '¿Se puede descargar el archivo y abrirlo? Es una pregunta de sí o no: si el servidor no responde, o el archivo llega dañado, no hay dato que reutilizar por muy completa que esté su ficha.',
    inPortal: 'Es el 30% del índice y la dimensión que este portal comprueba descargando de verdad cada archivo.',
  },
  {
    id: 'contenido',
    term: 'Calidad del contenido',
    group: 'calidad',
    definition:
      'Una vez que el archivo abre: ¿están los datos limpios? Columnas con nombre, tipos coherentes, sin filas repetidas ni celdas descuadradas. Aquí no hay sí o no, hay grados.',
    inPortal:
      'Es el otro 30%. Se mide solo sobre lo que abre: un archivo que no se puede leer no tiene contenido que evaluar.',
  },
  {
    id: 'dimension-de-calidad',
    term: 'Dimensión de calidad',
    group: 'calidad',
    definition:
      'Cada uno de los aspectos independientes en los que se puede evaluar un dato. Este portal usa tres: metadatos, disponibilidad y contenido. Se miden por separado porque se corrigen de forma distinta.',
  },
  {
    id: 'actualidad',
    term: 'Actualidad',
    aka: 'vigencia',
    group: 'calidad',
    definition:
      'Si el dato está al día respecto a la periodicidad que declara. Requiere saber cuándo se actualizó por última vez.',
    inPortal:
      'El portal distingue el retraso demostrado —el conjunto publica su fecha de actualización y la ha superado— del que no se puede verificar, porque son dos correcciones distintas.',
  },
  {
    id: 'causa-sistemica',
    term: 'Causa sistémica',
    group: 'calidad',
    definition:
      'Un mismo fallo que se repite en todos los archivos de un formato. No son N problemas independientes: es un proceso de publicación que falla, y se arregla una vez.',
    inPortal:
      'Las prioridades se ordenan por esto: un fallo que alcanza a un formato entero sube arriba aunque afecte a menos archivos que otro.',
  },
  {
    id: 'sello-de-calidad',
    term: 'Sello de calidad',
    group: 'calidad',
    definition:
      'Una imagen que muestra el índice de calidad de un conjunto de datos según el último análisis publicado. Cualquiera puede incrustarla en su web.',
  },

  /* ── Formatos y servicios ── */
  {
    id: 'formato-abierto',
    term: 'Formato abierto',
    group: 'formatos',
    definition:
      'Un formato que cualquiera puede leer sin comprar un programa concreto ni pedir permiso: CSV, JSON, GeoJSON. Lo contrario obliga a quien reutiliza a tener una herramienta específica.',
  },
  {
    id: 'csv',
    term: 'CSV',
    group: 'formatos',
    definition:
      'Una tabla en texto plano, con las columnas separadas por comas o puntos y coma. Lo abre cualquier hoja de cálculo y cualquier programa. Es el formato más reutilizable que hay para datos tabulares.',
  },
  {
    id: 'json',
    term: 'JSON',
    group: 'formatos',
    definition:
      'Un formato de texto pensado para que los programas intercambien datos con estructura. Es lo que devuelve la API de este portal.',
  },
  {
    id: 'geoespacial',
    term: 'Dato geoespacial',
    group: 'formatos',
    definition:
      'Un dato que lleva asociada una posición en el mapa: los límites de un municipio, la ubicación de un centro de salud.',
    inPortal: 'El catálogo se puede filtrar para ver solo estos, y el portal los previsualiza sobre un mapa.',
  },
  {
    id: 'shapefile',
    term: 'Shapefile',
    group: 'formatos',
    definition:
      'El formato de mapas más extendido. No es un archivo sino varios que viajan juntos dentro de un ZIP; si falta alguno, el mapa no se puede abrir.',
  },
  {
    id: 'servicio-de-mapas',
    term: 'Servicio de mapas',
    aka: 'WMS, WFS',
    group: 'formatos',
    definition:
      'En lugar de descargarse un archivo, se consulta un servidor que devuelve el mapa al momento. WMS entrega una imagen ya dibujada; WFS entrega los datos en bruto, que se pueden analizar.',
    inPortal: 'El portal los comprueba igual que a un archivo: pregunta al servicio qué capas ofrece y verifica que responde.',
  },
  {
    id: 'api',
    term: 'API',
    group: 'formatos',
    definition:
      'Una dirección web pensada para que la consulte un programa en vez de una persona. Devuelve datos estructurados, no una página.',
    inPortal: 'Todo lo que se ve en el portal está también disponible por API, sin registro ni clave.',
  },
];
