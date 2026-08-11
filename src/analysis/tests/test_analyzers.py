"""Tests de los analizadores de formato (cobertura por formato del catálogo)."""
from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Tabulares
# ---------------------------------------------------------------------------

def test_csv_valido():
    from src.analysis.formats.tabular import analyze_csv

    res = analyze_csv(FIXTURES / "valid.csv", {})
    assert res["ok"] is True
    assert res["metrics"]["rows"] == 3
    assert res["metrics"]["columns"] == 3
    assert res["score"] == 100


def test_csv_esquema_y_muestra():
    from src.analysis.formats.tabular import analyze_csv

    res = analyze_csv(FIXTURES / "valid.csv", {})
    schema = res["schema"]
    assert len(schema) == 3
    by_name = {f["name"]: f for f in schema}
    assert by_name["edad"]["type"] == "number"
    assert by_name["nombre"]["type"] == "string"
    assert by_name["edad"]["min"] == 28
    assert by_name["edad"]["max"] == 41
    assert by_name["edad"]["distinct"] == 3
    assert by_name["edad"]["null_count"] == 0
    assert by_name["edad"]["null_pct"] == 0
    assert res["sample_rows"][0][0] == "Ana"
    assert len(res["sample_rows"]) == 3


def test_csv_con_errores():
    from src.analysis.formats.tabular import analyze_csv

    res = analyze_csv(FIXTURES / "invalid.csv", {})
    assert res["ok"] is False
    codes = {i["code"] for i in res["issues"]}
    assert "error-tipo" in codes          # "abc" en columna edad
    assert "celda-faltante" in codes       # celdas vacías
    assert "fila-vacia" in codes           # fila completamente vacía
    assert res["score"] < 100


def test_json_tabular_valido():
    from src.analysis.formats.tabular import analyze_json

    res = analyze_json(FIXTURES / "valid.json", {})
    assert res["ok"] is True
    assert res["metrics"]["rows"] == 2
    assert res["schema"] and res["sample_rows"]


def test_json_invalido():
    from src.analysis.formats.tabular import analyze_json

    res = analyze_json(FIXTURES / "broken.json", {})
    assert res["ok"] is False
    assert any(i["code"] == "json-invalido" for i in res["issues"])


# ---------------------------------------------------------------------------
# XML / RSS / KML / RDF
# ---------------------------------------------------------------------------

def test_xml_generico_valido():
    from src.analysis.formats.xml_formats import analyze_xml_generic

    res = analyze_xml_generic(FIXTURES / "sample.xml", {})
    assert res["ok"] is True
    assert res["metrics"]["root_local"] == "indice"


def test_xml_invalido():
    from src.analysis.formats.xml_formats import analyze_xml_generic

    res = analyze_xml_generic(FIXTURES / "invalid.xml", {})
    assert res["ok"] is False
    assert any(i["code"] == "xml-no-bien-formado" for i in res["issues"])


def test_rss():
    from src.analysis.formats.xml_formats import analyze_rss

    res = analyze_rss(FIXTURES / "sample.rss", {})
    assert res["ok"] is True
    assert res["metrics"]["items"] == 2


def test_kml():
    from src.analysis.formats.xml_formats import analyze_kml

    res = analyze_kml(FIXTURES / "sample.kml", {})
    assert res["ok"] is True
    assert res["metrics"]["placemarks"] == 1
    assert res["metrics"]["root_local"] == "kml"


def test_rdf_parse_catalog():
    from src.analysis.catalog import iter_distributions

    items = iter_distributions((FIXTURES / "mini-catalog.rdf").read_bytes())
    assert len(items) == 2
    assert {i["format"] for i in items} == {"CSV", "XLSX"}
    assert all(i["url"] for i in items)


# ---------------------------------------------------------------------------
# Geo
# ---------------------------------------------------------------------------

def test_geojson_con_geometria_nula():
    from src.analysis.formats.geo import analyze_geojson

    res = analyze_geojson(FIXTURES / "sample.geojson", {})
    assert res["ok"] is False
    assert res["metrics"]["features"] == 2
    assert res["metrics"]["null_geometries"] == 1
    assert any(i["code"] == "geometria-nula" for i in res["issues"])


def test_shapefile_zip():
    import shapefile as pyshp

    from src.analysis.formats.shapefile import analyze_zip_shapefile

    with pyshp.Writer(tmp := str(FIXTURES / "_shp_test"), shapeType=pyshp.POINT) as w:
        w.field("nombre", "C", 20)
        for i, (x, y) in enumerate([(-4.7, 41.6), (-5.0, 40.0), (-3.0, 39.0)]):
            w.point(x, y)
            w.record(f"Punto {i}")
    # pyshp no genera .prj: lo creamos a mano (EPSG:4326)
    Path(tmp + ".prj").write_text(
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
        'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
        encoding="utf-8",
    )
    zip_path = FIXTURES / "_shp_test.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for suffix in (".shp", ".shx", ".dbf", ".prj"):
            zf.write(tmp + suffix, f"test{suffix}")
    try:
        res = analyze_zip_shapefile(zip_path, {})
        assert res["ok"] is True
        assert res["metrics"]["features"] == 3
        assert res["metrics"]["has_projection"] is True
        assert res["metrics"]["missing_components"] == []
    finally:
        for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg", ".dbf.xml"):
            Path(tmp + suffix).unlink(missing_ok=True)
        zip_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Excel / iCal / JPEG / binario
# ---------------------------------------------------------------------------

def test_xlsx():
    import openpyxl

    from src.analysis.formats.excel import analyze_xlsx

    path = FIXTURES / "_test.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Datos"
    ws.append(["nombre", "edad"])
    ws.append(["Ana", 34])
    ws.append(["Luis", 28])
    wb.save(path)
    try:
        res = analyze_xlsx(path, {})
        assert res["ok"] is True
        assert res["metrics"]["sheet_count"] == 1
        assert res["metrics"]["total_rows"] == 3
        assert res["schema"][0]["name"] == "nombre"
        assert res["schema"][1]["type"] == "number"
        assert res["sample_rows"][0][0] == "Ana"
    finally:
        path.unlink(missing_ok=True)


def test_ical():
    from src.analysis.formats.ical import analyze_ical

    res = analyze_ical(FIXTURES / "sample.ics", {})
    assert res["ok"] is True
    assert res["metrics"]["events"] == 1


def test_jpeg():
    from PIL import Image

    from src.analysis.formats.images import analyze_jpeg

    path = FIXTURES / "_test.jpg"
    Image.new("RGB", (12, 24), "white").save(path, "JPEG")
    try:
        res = analyze_jpeg(path, {})
        assert res["ok"] is True
        assert res["metrics"]["width"] == 12
        assert res["metrics"]["height"] == 24
    finally:
        path.unlink(missing_ok=True)


def test_binary_zip_detectado():
    from src.analysis.formats.binary import analyze_binary

    path = FIXTURES / "_test.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("x.txt", "contenido")
    try:
        res = analyze_binary(path, {"declared_format": "BIN"})
        assert res["metrics"]["detected"]["extension"] == "zip"
        assert any(i["code"] == "tipo-detectado" for i in res["issues"])
    finally:
        path.unlink(missing_ok=True)


def test_ecw_firma():
    from src.analysis.formats.images import analyze_ecw

    path = FIXTURES / "_test.ecw"
    path.write_bytes(b"ECW\x00" + b"\x00" * 64)
    try:
        res = analyze_ecw(path, {})
        assert res["ok"] is True
    finally:
        path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Anti falsos positivos (causas nuestras, no del dataset)
# ---------------------------------------------------------------------------

def test_csv_columnas_dispersas_no_penaliza():
    """Columnas casi vacías (opcionales) no deben generar errores masivos."""
    from src.analysis.formats.tabular import analyze_csv

    path = FIXTURES / "_sparse.csv"
    rows = ["A;B;C;EMAIL;WEB;OBS", "1;x;y;;;", "2;a;b;;;", "3;c;d;;;"]
    path.write_text("\n".join(rows), encoding="utf-8")
    try:
        res = analyze_csv(path, {})
        assert res["ok"] is True
        assert all(i["severity"] == "warning" for i in res["issues"])
        assert not any(i["code"] == "error-tipo" for i in res["issues"])
    finally:
        path.unlink(missing_ok=True)


def test_csv_celda_faltante_consolidada():
    """El celda-faltante de Frictionless y el propio se fusionan en uno solo."""
    from src.analysis.formats.tabular import analyze_csv

    path = FIXTURES / "_merge.csv"
    # El fixture valid no tiene missing; creamos uno pequeño con celdas vacías
    path.write_text("a;b;c\n1;;3\n4;5;\n7;8;9\n", encoding="utf-8")
    try:
        res = analyze_csv(path, {})
        present = [i for i in res["issues"] if i["code"] == "celda-faltante"]
        assert len(present) == 1, f"esperaba 1 issue, hay {len(present)}"
    finally:
        path.unlink(missing_ok=True)


def test_merge_issues_no_downgrade_severidad():
    """Fusionar un warning con un error del mismo código no debe downgrade a warning."""
    from src.analysis.formats.tabular import _merge_issues

    issues = [
        {"code": "celda-faltante", "severity": "warning", "count": 10, "samples": [{"row": 1}]},
        {"code": "celda-faltante", "severity": "error", "count": 3, "samples": [{"row": 2}]},
    ]
    merged = _merge_issues(issues)
    assert len(merged) == 1
    assert merged[0]["severity"] == "error", "la mezcla con un error debe ser 'error'"
    assert merged[0]["count"] == 13


def test_merge_issues_severidad_warning_si_solo_warnings():
    """Solo warnings fusionados se mantienen como warning."""
    from src.analysis.formats.tabular import _merge_issues

    issues = [
        {"code": "celda-faltante", "severity": "warning", "count": 2},
        {"code": "celda-faltante", "severity": "warning", "count": 1},
    ]
    merged = _merge_issues(issues)
    assert merged[0]["severity"] == "warning"
    assert merged[0]["count"] == 3


def test_shapefile_html_directorio_no_dice_zip_invalido():
    """URL que devuelve HTML (directorio/landing) -> no-es-archivo, no zip-invalido."""
    from src.analysis.formats.shapefile import analyze_zip_shapefile

    path = FIXTURES / "_dir.html"
    path.write_text("<!DOCTYPE html><html><head><title>Index of /cartografia</title></head><body>...</body></html>", encoding="utf-8")
    try:
        res = analyze_zip_shapefile(path, {})
        assert res["ok"] is False
        codes = {i["code"] for i in res["issues"]}
        assert "no-es-archivo" in codes
        assert "zip-invalido" not in codes
    finally:
        path.unlink(missing_ok=True)


def test_json_html_directorio_no_dice_json_invalido():
    """URL que devuelve HTML -> no-es-archivo, no json-invalido."""
    from src.analysis.formats.tabular import analyze_json

    path = FIXTURES / "_merge.json"
    path.write_text("<!DOCTYPE html><html><body>Index</body></html>", encoding="utf-8")
    try:
        res = analyze_json(path, {})
        codes = {i["code"] for i in res["issues"]}
        assert "no-es-archivo" in codes
        assert "json-invalido" not in codes
    finally:
        path.unlink(missing_ok=True)


def test_engine_remap_no_es_archivo_a_skipped():
    """Un HTML de directorio (no-es-archivo) debe marcarse 'skipped', no 'error'."""
    import src.analysis.engine as engine
    from src.analysis.downloader import FetchResult

    html = FIXTURES / "_html_dir.html"
    html.write_text("<!DOCTYPE html><html><body>Index of /cartografia</body></html>", encoding="utf-8")

    def fake_fetch(url, dest_dir, cap, timeout=60, retries=2, on_start=None):
        return FetchResult(status="downloaded", path=html, size=html.stat().st_size,
                           http_status=200, final_url=url)

    try:
        with tempfile.TemporaryDirectory() as tmp:
            ctx = {"run_dir": tmp, "size_cap": 1_000_000, "sample_cap": 1_000_000,
                   "timeout": 5, "retries": 0}
            item = {
                "dataset_index": 0, "dataset_id": "1", "dataset_title": "Test",
                "url": "https://example.org/index", "format": "CSV", "mime": "",
            }
            original_fetch = engine.fetch
            engine.fetch = fake_fetch
            try:
                result = engine.run_item(item, ctx)
            finally:
                engine.fetch = original_fetch

            assert result["status"] == "skipped", f"esperaba skipped, {result['status']}"
            codes = [i["code"] for i in (result["analysis"] or {}).get("issues", [])]
            assert codes == ["no-es-archivo"]
    finally:
        html.unlink(missing_ok=True)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
