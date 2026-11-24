"""Genera banco/lemas.json: forma de una palabra -> su lema, solo para las palabras que tienen signo.

El modo directo (la app del móvil) no tiene el procesado de Python, así que lleva esta tabla para saber que
«comiendo» es «comer» o que «vengáis» es «venir». Se limita a los lemas con signo (movimiento extraído, signos propios,
equivalencias y compuestos) para que pese poco.

    py herramientas/generar_lemas.py
"""
import glob
import json
import os
import sys

from simplemma.strategies.dictionaries.dictionary_factory import DefaultDictionaryFactory

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texto import normalizar  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def vocabulario():
    palabras = set()
    with open(os.path.join(RAIZ, "banco", "poses", "indice.json"), encoding="utf-8") as f:
        palabras |= {normalizar(p) for p in json.load(f)}
    for ruta in [os.path.join(RAIZ, "banco", "propios", "signos.json")] + sorted(glob.glob(os.path.join(RAIZ, "banco", "propios", "lotes", "lote_*.json"))):
        with open(ruta, encoding="utf-8") as f:
            for s in json.load(f)["signos"].values():
                palabras |= {normalizar(p) for p in s["palabras"]}
    for nombre, clave in (("sinonimos.json", "sinonimos"), ("compuestos.json", "compuestos")):
        with open(os.path.join(RAIZ, "banco", "propios", nombre), encoding="utf-8") as f:
            palabras |= {normalizar(p) for p in json.load(f)[clave]}
    palabras.discard("")
    return palabras


def main():
    vocab = vocabulario()
    diccionario = DefaultDictionaryFactory().get_dictionary("es")
    lemas = {}
    for forma in diccionario:
        if not forma.islower() or " " in forma:
            continue
        lema = diccionario[forma]
        if isinstance(lema, bytes):
            lema = lema.decode("utf-8")
        if lema != forma and normalizar(lema) in vocab and normalizar(forma) not in vocab:
            lemas[forma] = lema
    destino = os.path.join(RAIZ, "banco", "lemas.json")
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        json.dump(lemas, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(len(lemas), "formas ->", destino, round(os.path.getsize(destino) / 1024), "KB")


if __name__ == "__main__":
    main()
