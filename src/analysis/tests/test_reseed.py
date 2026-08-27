"""
Tests de la reconstrucción de resultados a partir de un informe publicado.

`reseed` existe para que corregir un defecto del analizador no cueste volver a
descargar los 23 GB del catálogo: se re-analiza solo lo que el defecto tocaba y
el resto se reutiliza del informe anterior.

Eso solo vale si la reconstrucción es EXACTA. Si se inventa o pierde algo, el
informe siguiente arrastraría datos falsos en las 1.359 distribuciones que nadie
ha vuelto a mirar, y sería invisible: el portal enseñaría cifras coherentes y
equivocadas. De ahí que los tests se centren en la fidelidad y no en el ahorro.
"""
from __future__ import annotations

import json
from pathlib import Path

from src.analysis.bundle import shard_id, write_bundle
from src.analysis.reseed import load_results, verify_roundtrip, write_checkpoint


def _resultado(url: str, *, con_detalle: bool = True) -> dict:
    """Un resultado con todas las partes que el bundle reparte en dos mitades."""
    analysis: dict = {
        "ok": True,
        "score": 87,
        "summary": "3 filas, 2 columnas",
        "metrics": {"rows": 3, "header": ["municipio", "provincia"]},
        "issues": [
            {
                "code": "celda-vacia",
                "label": "Celdas vacías",
                "severity": "warning",
                "count": 2,
                "stored": True,
                # Estas dos claves son las que viajan al fragmento.
                "columns": [0, 1],
                "rows": [4, 9],
            },
            {
                "code": "cabecera-duplicada",
                "label": "Cabecera duplicada",
                "severity": "error",
                "count": 1,
                "stored": False,
            },
        ],
        "truncated": False,
    }
    if con_detalle:
        analysis["schema"] = [{"name": "municipio", "type": "string"}]
        analysis["sample_rows"] = [["Peñafiel", "Valladolid"]]
    else:
        # `stored` y las posiciones van juntas: la marca es precisamente lo que
        # decide si se guardan. Una incidencia con `stored: False` que llevara
        # `columns`/`rows` sería un resultado que el analizador no produce, y el
        # bundle las descartaría con razón.
        for issue in analysis["issues"]:
            issue["stored"] = False
            issue.pop("columns", None)
            issue.pop("rows", None)
    return {
        "dataset_index": 0,
        "dataset_id": "https://datosabiertos.jcyl.es/dataset/uno",
        "dataset_title": "Conjunto uno",
        "format": "CSV",
        "mime": "text/csv",
        "url": url,
        "status": "ok",
        "fetch": {"status": "downloaded", "size": 1024, "http_status": 200},
        "analysis": analysis,
        "duration_ms": 12,
    }


def _informe(resultados: list[dict]) -> dict:
    """
    El informe pasa por `aggregate`, no se escribe a mano.

    Los totales, el reparto por formato y las puntuaciones por conjunto son
    DERIVADOS de los resultados. Escribirlos a mano da un informe que ninguna
    ejecución produciría, y entonces el test del ciclo completo falla por la
    diferencia entre mi fixture y la agregación de verdad, que no es lo que se
    quiere comprobar.
    """
    from src.analysis.report import aggregate

    report = aggregate(resultados)
    report["source"] = {"url": "catalogo.rdf", "generated_at": report["generated_at"]}
    return report


def test_reconstruye_el_resultado_completo(tmp_path):
    """Las dos mitades vuelven a ser una: esquema, filas de muestra y posiciones."""
    original = _resultado("https://ejemplo/a.csv")
    write_bundle(_informe([original]), tmp_path)

    recuperados = load_results(tmp_path)

    assert len(recuperados) == 1
    assert recuperados[0] == original, "el resultado reconstruido no es el original"


def test_las_posiciones_vuelven_a_su_incidencia(tmp_path):
    """
    El emparejamiento va por código de incidencia.

    Es seguro porque el analizador agrupa las ocurrencias por código antes de
    guardarlas —ninguna de las 1.683 distribuciones del informe publicado repite
    código—, pero conviene fijarlo: si algún día se guardaran dos incidencias con
    el mismo código, las posiciones acabarían en la equivocada.
    """
    original = _resultado("https://ejemplo/a.csv")
    write_bundle(_informe([original]), tmp_path)

    issues = load_results(tmp_path)[0]["analysis"]["issues"]
    vacia = next(i for i in issues if i["code"] == "celda-vacia")
    cabecera = next(i for i in issues if i["code"] == "cabecera-duplicada")

    assert vacia["rows"] == [4, 9]
    assert "rows" not in cabecera, "posiciones asignadas a una incidencia que no las tenía"


def test_una_distribucion_sin_detalle_no_inventa_fragmento(tmp_path):
    """Sin esquema ni posiciones no hay fragmento, y reconstruir no debe suponerlo."""
    original = _resultado("https://ejemplo/b.csv", con_detalle=False)
    write_bundle(_informe([original]), tmp_path)

    assert not (tmp_path / "d" / f"{shard_id(original['url'])}.json").exists()
    assert load_results(tmp_path) == [original]


def test_un_fragmento_que_falta_no_tumba_la_reconstruccion(tmp_path):
    """
    Un bundle a medias es posible —`_empty_shard_dir` avisa de los fragmentos que
    no pudo borrar—, y perder detalle es mejor que no poder reconstruir nada.
    """
    original = _resultado("https://ejemplo/a.csv")
    write_bundle(_informe([original]), tmp_path)
    (tmp_path / "d" / f"{shard_id(original['url'])}.json").unlink()

    recuperado = load_results(tmp_path)[0]

    assert recuperado["analysis"]["score"] == 87          # el estado sobrevive
    assert "schema" not in recuperado["analysis"]          # el detalle, no


def test_el_ciclo_completo_devuelve_el_mismo_bundle(tmp_path):
    """
    La comprobación que de verdad autoriza a usar esto: reconstruir, volver a
    agregar y volver a escribir tiene que dar el informe de partida.

    Cubre de paso que `aggregate` recalcula las puntuaciones y los recuentos por
    conjunto a partir de los resultados, así que un resultado reconstruido a
    medias se notaría aquí y no en producción.
    """
    resultados = [_resultado("https://ejemplo/a.csv"), _resultado("https://ejemplo/b.csv")]
    bundle = tmp_path / "bundle"
    write_bundle(_informe(resultados), bundle)

    diffs = verify_roundtrip(bundle, tmp_path / "scratch")

    assert diffs == [], f"el ciclo no es fiel: {diffs}"


def test_el_checkpoint_omite_lo_que_hay_que_re_analizar(tmp_path):
    """
    Lo que se deja fuera del checkpoint es exactamente lo que se volverá a
    descargar. Si se colara una URL que había que re-analizar, se publicaría otra
    vez el resultado defectuoso sin que nada avisara.
    """
    a, b = _resultado("https://ejemplo/a.csv"), _resultado("https://ejemplo/b.csv")
    bundle = tmp_path / "bundle"
    write_bundle(_informe([a, b]), bundle)
    destino = tmp_path / "checkpoint.jsonl"

    resumen = write_checkpoint(bundle, destino, {"https://ejemplo/a.csv"})

    assert resumen == {"guardados": 1, "omitidos": 1}
    lineas = [json.loads(l) for l in destino.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert [l["url"] for l in lineas] == ["https://ejemplo/b.csv"]
    # Y lo que se reutiliza tiene que llegar entero, con su detalle.
    assert lineas[0]["result"] == b


def test_el_checkpoint_resembrado_lo_entiende_el_motor(tmp_path):
    """
    El formato no se comprueba a ojo: lo lee `_load_checkpoint`, que es quien
    tiene que reconocerlo.
    """
    from src.analysis.engine import _load_checkpoint

    a = _resultado("https://ejemplo/a.csv")
    bundle = tmp_path / "bundle"
    write_bundle(_informe([a]), bundle)
    destino = tmp_path / "checkpoint.jsonl"
    write_checkpoint(bundle, destino, set())

    cargado = _load_checkpoint(destino)

    assert cargado == {"https://ejemplo/a.csv": a}


def test_el_checkpoint_se_reescribe_y_no_se_acumula(tmp_path):
    """
    Con `append`, resembrar dos veces dejaría la primera versión debajo y
    `_load_checkpoint` se quedaría con la última por URL: funcionaría por
    casualidad y crecería sin motivo.
    """
    a = _resultado("https://ejemplo/a.csv")
    bundle = tmp_path / "bundle"
    write_bundle(_informe([a]), bundle)
    destino = tmp_path / "checkpoint.jsonl"

    write_checkpoint(bundle, destino, set())
    write_checkpoint(bundle, destino, set())

    assert len(destino.read_text(encoding="utf-8").strip().splitlines()) == 1


def test_el_informe_publicado_se_reconstruye_entero():
    """
    Sobre el informe de verdad, no sobre uno de laboratorio.

    Los fixtures de arriba prueban la mecánica; esto prueba que el bundle
    publicado —1.683 distribuciones, 1.195 fragmentos— entra completo. Un
    resultado que se quedara por el camino saldría aquí como una cuenta que no
    cuadra con `totals`.
    """
    bundle = Path("reports") / "current"
    if not (bundle / "index.json").exists():
        return  # sin informe publicado en este árbol

    index = json.loads((bundle / "index.json").read_text(encoding="utf-8"))
    esperados = sum(len(ds["distribution_results"]) for ds in index["datasets"])

    resultados = load_results(bundle)

    assert len(resultados) == esperados == index["totals"]["distributions"]
    assert all(r.get("url") for r in resultados)
    assert all("id" not in r and "has_detail" not in r for r in resultados), (
        "las claves que añade el índice se han colado en el resultado reconstruido"
    )
