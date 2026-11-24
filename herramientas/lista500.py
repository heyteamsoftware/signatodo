"""Lee la lista de 500 signos básicos (Documentacion/500_signos_LSE_parametros_querologicos (Gemini).docx)
y la cruza con el movimiento extraído (ARASAAC) y los signos propios.

    py herramientas\\lista500.py extraer     guarda banco\\lista500.json
    py herramientas\\lista500.py cobertura   informe de cobertura por categoría
"""
import glob
import json
import os
import re
import sys

import docx

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
from texto import normalizar  # noqa: E402

DOCX = os.path.join(RAIZ, "Documentacion", "500_signos_LSE_parametros_querologicos (Gemini).docx")
SALIDA = os.path.join(RAIZ, "banco", "lista500.json")


def extraer():
    d = docx.Document(DOCX)
    entradas, categoria = [], ""
    for t in d.tables:
        filas = [[c.text.strip().replace("\n", " / ") for c in r.cells] for r in t.rows]
        if len(filas) == 1 and re.match(r"\d+\.\s", filas[0][0]):
            categoria = re.sub(r"\s*\(\d+.\d+\)\s*$", "", filas[0][0])
            continue
        if filas and filas[0][0] == "N.º":
            for f in filas[1:]:
                if len(f) < 6 or not f[0].isdigit():
                    continue
                entradas.append({"n": int(f[0]), "categoria": categoria, "glosa": f[1], "configuracion": f[2],
                                 "ubicacion": f[3], "movimiento": f[4], "cnm": f[5]})
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump(entradas, f, ensure_ascii=False, indent=1)
    print(len(entradas), "entradas ->", SALIDA)
    return entradas


def variantes(glosa):
    """'CASA / HOGAR' -> ['CASA', 'HOGAR'];  'CITA-PREVIA' -> ['CITA PREVIA'];  'X (algo)' -> ['X']."""
    limpia = re.sub(r"\(.*?\)", " ", glosa)
    partes = [p for p in re.split(r"\s*/\s*|\s+O\s+", limpia) if p.strip()]
    return [normalizar(p.replace("-", " ")) for p in partes]


def cargar_recursos():
    with open(os.path.join(RAIZ, "referencia", "arasaac", "indice.json"), encoding="utf-8") as f:
        arasaac = {normalizar(p): p for p, ac in json.load(f)["palabras"].items() if any(a["videos"] for a in ac)}
    with open(os.path.join(RAIZ, "banco", "poses", "indice.json"), encoding="utf-8") as f:
        extraidos = set(json.load(f))
    propios = {}
    for ruta in [os.path.join(RAIZ, "banco", "propios", "signos.json")] + sorted(glob.glob(os.path.join(RAIZ, "banco", "propios", "lotes", "lote_*.json"))):
        with open(ruta, encoding="utf-8") as f:
            for ident, s in json.load(f)["signos"].items():
                for p in s["palabras"]:
                    propios[normalizar(p)] = ident
    return arasaac, extraidos, propios


def clasificar(entrada, arasaac, extraidos, propios):
    """Estado de una entrada: ('movimiento'|'propio'|'compuesto'|'falta', variante que coincide)."""
    if entrada["configuracion"].lower().startswith("compuesto"):
        compuesto = True
    else:
        compuesto = False
    for v in variantes(entrada["glosa"]):
        if v in extraidos:
            return "movimiento", v
    for v in variantes(entrada["glosa"]):
        if v in propios:
            return "propio", v
    return ("compuesto" if compuesto else "falta"), None


def cobertura():
    entradas = json.load(open(SALIDA, encoding="utf-8")) if os.path.isfile(SALIDA) else extraer()
    arasaac, extraidos, propios = cargar_recursos()
    por_cat = {}
    for e in entradas:
        estado, _ = clasificar(e, arasaac, extraidos, propios)
        por_cat.setdefault(e["categoria"], {}).setdefault(estado, []).append(e["glosa"])
    total = {"movimiento": 0, "propio": 0, "compuesto": 0, "falta": 0}
    for cat, estados in por_cat.items():
        n = sum(len(v) for v in estados.values())
        partes = ", ".join(f"{k} {len(estados.get(k, []))}" for k in total)
        print(f"{cat}: {n}  ->  {partes}")
        for k in total:
            total[k] += len(estados.get(k, []))
    print("\nTOTAL", total, "de", sum(total.values()))
    return por_cat


if __name__ == "__main__":
    orden = sys.argv[1] if len(sys.argv) > 1 else "cobertura"
    if orden == "extraer":
        extraer()
    else:
        cobertura()
