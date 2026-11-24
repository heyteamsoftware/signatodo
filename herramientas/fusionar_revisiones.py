"""Aplica las revisiones (banco/propios/revisiones/rev_*.json) sobre los signos originales.

Cada signo revisado sustituye al que tiene el mismo id en banco/propios/signos.json o en
banco/propios/lotes/lote_*.json. Los ficheros de revisión se mueven a revisiones/aplicadas/.

    py herramientas\\fusionar_revisiones.py            aplica todas las revisiones pendientes
    py herramientas\\fusionar_revisiones.py --simular  solo cuenta qué cambiaría
"""
import glob
import json
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPIOS = os.path.join(RAIZ, "banco", "propios")


def main():
    simular = "--simular" in sys.argv
    destinos = [os.path.join(PROPIOS, "signos.json")] + sorted(glob.glob(os.path.join(PROPIOS, "lotes", "lote_*.json")))
    datos = {}
    donde = {}
    for ruta in destinos:
        with open(ruta, encoding="utf-8") as f:
            datos[ruta] = json.load(f)
        for ident in datos[ruta]["signos"]:
            donde[ident] = ruta

    revisiones = sorted(glob.glob(os.path.join(PROPIOS, "revisiones", "rev_*.json")))
    cambiados, desconocidos, subidas = 0, [], {}
    for rev in revisiones:
        with open(rev, encoding="utf-8") as f:
            nuevos = json.load(f)["signos"]
        for ident, signo in nuevos.items():
            ruta = donde.get(ident)
            if not ruta:
                desconocidos.append(ident)
                continue
            antes = datos[ruta]["signos"][ident].get("confianza")
            despues = signo.get("confianza")
            subidas[(antes, despues)] = subidas.get((antes, despues), 0) + 1
            datos[ruta]["signos"][ident] = signo
            cambiados += 1
    print(f"{cambiados} signos revisados de {len(revisiones)} ficheros")
    for (a, d), n in sorted(subidas.items(), key=lambda x: str(x)):
        print(f"  confianza {a} -> {d}: {n}")
    if desconocidos:
        print("  ids sin original (no aplicados):", ", ".join(desconocidos))
    if simular or not cambiados:
        return
    for ruta, contenido in datos.items():
        with open(ruta, "w", encoding="utf-8", newline="\n") as f:
            json.dump(contenido, f, ensure_ascii=False, indent=1)
            f.write("\n")
    aplicadas = os.path.join(PROPIOS, "revisiones", "aplicadas")
    os.makedirs(aplicadas, exist_ok=True)
    for rev in revisiones:
        shutil.move(rev, os.path.join(aplicadas, os.path.basename(rev)))
    print("Revisiones aplicadas y archivadas en", aplicadas)


if __name__ == "__main__":
    main()
