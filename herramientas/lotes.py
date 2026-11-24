"""Reparte las palabras que faltan por describir en lotes, para trabajar en paralelo sin repetir.

    py herramientas\\lotes.py estado                 cuántas hay hechas, asignadas y pendientes
    py herramientas\\lotes.py siguiente 30           reserva y muestra las próximas 30 palabras (lote nuevo)
    py herramientas\\lotes.py liberar lote_003       devuelve un lote reservado que no se llegó a hacer

Orden de prioridad: primero las palabras del banco básico de tarjetas (vocabulario cotidiano), luego el
resto de palabras con vídeo de referencia, y al final las expresiones de varias palabras.
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
from texto import normalizar  # noqa: E402

PROPIOS = os.path.join(RAIZ, "banco", "propios")
LOTES = os.path.join(PROPIOS, "lotes")
ASIGNADOS = os.path.join(LOTES, "asignados.json")


def hechas():
    """Palabras que ya tienen signo propio (normalizadas)."""
    palabras = set()
    ficheros = [os.path.join(PROPIOS, "signos.json")]
    if os.path.isdir(LOTES):
        ficheros += [os.path.join(LOTES, n) for n in sorted(os.listdir(LOTES)) if n.startswith("lote_") and n.endswith(".json")]
    for f in ficheros:
        if os.path.isfile(f):
            with open(f, encoding="utf-8") as fh:
                for s in json.load(fh).get("signos", {}).values():
                    palabras.update(normalizar(p) for p in s.get("palabras", []))
    return palabras


def asignados():
    if os.path.isfile(ASIGNADOS):
        with open(ASIGNADOS, encoding="utf-8") as f:
            return json.load(f)
    return {}


def candidatas():
    """(palabra de ARASAAC, clave normalizada) en orden de prioridad."""
    with open(os.path.join(RAIZ, "referencia", "arasaac", "indice.json"), encoding="utf-8") as f:
        arasaac = json.load(f)["palabras"]
    with open(os.path.join(RAIZ, "banco", "indice.json"), encoding="utf-8") as f:
        basicas = set(json.load(f)["claves"])
    con_video = [(p, normalizar(p)) for p, ac in arasaac.items() if any(a["videos"] for a in ac)]
    def prioridad(par):
        palabra, clave = par
        return (0 if clave in basicas else 1, 1 if " " in clave else 0, clave)
    return sorted(con_video, key=prioridad)


def main():
    orden = sys.argv[1] if len(sys.argv) > 1 else "estado"
    os.makedirs(LOTES, exist_ok=True)
    reservado = asignados()
    ya = hechas()
    en_lotes = {normalizar(p) for lista in reservado.values() for p in lista}
    todas = candidatas()
    if orden == "estado":
        pendientes = [c for c in todas if c[1] not in ya and c[1] not in en_lotes]
        print(f"con vídeo de referencia: {len(todas)} | hechas: {len(ya)} | reservadas en lotes: {len(en_lotes - ya)} | por asignar: {len(pendientes)}")
    elif orden == "siguiente":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        pendientes = [c for c in todas if c[1] not in ya and c[1] not in en_lotes][:n]
        numero = 1 + max([int(k.split("_")[1]) for k in reservado] or [0])
        nombre = f"lote_{numero:03d}"
        reservado[nombre] = [p for p, _ in pendientes]
        with open(ASIGNADOS, "w", encoding="utf-8") as f:
            json.dump(reservado, f, ensure_ascii=False, indent=1)
        print(nombre)
        for p, _ in pendientes:
            print(p)
    elif orden == "liberar":
        reservado.pop(sys.argv[2], None)
        with open(ASIGNADOS, "w", encoding="utf-8") as f:
            json.dump(reservado, f, ensure_ascii=False, indent=1)
        print("liberado", sys.argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
