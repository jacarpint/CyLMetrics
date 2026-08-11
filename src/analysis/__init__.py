"""Análisis de la calidad de los datos del catálogo de la Junta de Castilla y León.

Audita cada distribución (URL de descarga) de los datasets del catálogo DCAT de
datosabiertos.jcyl.es y produce un informe JSON con métricas por formato:

  - Tabulares (CSV, TXT, JSON, XLSX):  Frictionless (validación + schema inferido)
  - Geográficos (SHP, GeoJSON, KML, GML): integridad estructural y de features
  - Servicios OGC (WMS, WFS):          GetCapabilities vía HTTP
  - Otros (XML, RDF, RSS, iCal, JPEG, ECW, BIN, OTRO): parsing / firma de archivo

Uso:
  python -m src.analysis --limit 0 --workers 8
"""

__version__ = "1.0.0"

# Frictionless v5 rechaza por seguridad las rutas absolutas ("path is not safe")
# salvo que el sistema se marque como "trusted". Aquí los ficheros a auditar se
# descargan siempre a nuestro propio run_dir (ruta absoluta), por lo que es
# correcto habilitarlo.
from frictionless import system as _frictionless_system

_frictionless_system.trusted = True  # noqa: E402

# openpyxl y Frictionless emiten warnings ruidosos con ficheros del mundo real
# (hojas sin estilos, validaciones no soportadas...); se silencian: no afectan
# a los resultados.
import warnings as _warnings  # noqa: E402

_warnings.filterwarnings("ignore", category=UserWarning, module=r"openpyxl.*")
_warnings.filterwarnings("ignore", category=UserWarning, message="Workbook contains no default style.*")
_warnings.filterwarnings("ignore", category=UserWarning, message="Data Validation extension.*")
