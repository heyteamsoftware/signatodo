"""Reparte las entradas de la lista de 500 que no tienen movimiento ni signo propio en N grupos.

    py herramientas\\repartir_faltantes.py 6 carpeta_de_salida

Escribe carpeta\\faltantes_01.json ... con las entradas (glosa, configuración, ubicación, movimiento, CNM).
Se omiten los signos compuestos (se resolverán encadenando otros signos).
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
from lista500 import cargar_recursos, clasificar  # noqa: E402


def main():
    n = int(sys.argv[1])
    salida = sys.argv[2]
    os.makedirs(salida, exist_ok=True)
    entradas = json.load(open(os.path.join(RAIZ, "banco", "lista500.json"), encoding="utf-8"))
    arasaac, extraidos, propios = cargar_recursos()
    faltan = [e for e in entradas if clasificar(e, arasaac, extraidos, propios)[0] == "falta"]
    tam = -(-len(faltan) // n)
    for k in range(n):
        grupo = faltan[k * tam:(k + 1) * tam]
        with open(os.path.join(salida, f"faltantes_{k + 1:02d}.json"), "w", encoding="utf-8") as f:
            json.dump(grupo, f, ensure_ascii=False, indent=1)
        print(k + 1, len(grupo), ", ".join(e["glosa"] for e in grupo))
    print(len(faltan), "entradas sin cobertura")


if __name__ == "__main__":
    main()
