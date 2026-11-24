"""Genera banco/propios/alfabeto.json: el alfabeto dactilológico propio (27 letras).

Cada letra es un signo breve de una mano con su forma, orientación y, en J, Ñ y Z, su trazo.
Se edita la tabla LETRAS y se vuelve a ejecutar:  py herramientas\\generar_alfabeto.py
"""
import json
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "banco", "propios", "alfabeto.json")

# Lugar de deletreo: delante del hombro dominante, a la altura de la barbilla.
POS = [0.82, 0.22, 0.55]


def dedos(*d):
    return list(d)


I = 1                                   # dedo cerrado
R = 0                                   # dedo recto
CURVO = [55, 60, 40]                    # dedo curvado hasta tocar el pulgar
DOBLADO = [10, 12, 6]                   # dedo casi recto, algo caído (M, N)

FORMAS = {
    "b": {"d": [R, R, R, R], "ab": [0, 0, 0, 0], "p": {"a": -40, "f": [25, 40, 25]}},
    "d": {"d": [R, CURVO, CURVO, CURVO], "ab": [0, 0, 0, 0], "p": {"a": 32, "f": [22, 38, 26]}},
    "g": {"d": [R, I, I, I], "ab": [0, 0, 0, 0], "p": {"a": 12, "f": [0, 0, 0]}},
    "h": {"d": [R, R, I, I], "ab": [0, 0, 0, 0], "p": {"a": -30, "f": [25, 40, 25]}},
    "i": {"d": [I, I, I, R], "ab": [0, 0, 0, 0], "p": {"a": -30, "f": [25, 40, 25]}},
    "m": {"d": [DOBLADO, DOBLADO, DOBLADO, I], "ab": [0, 0, 0, 0], "p": {"a": -40, "f": [30, 40, 25]}},
    "n": {"d": [DOBLADO, DOBLADO, I, I], "ab": [0, 0, 0, 0], "p": {"a": -40, "f": [30, 40, 25]}},
    "p": {"d": [R, R, R, I], "ab": [0, 0, 0, 0], "p": {"a": -40, "f": [25, 40, 25]}},
    "r": {"d": [R, R, I, I], "ab": [-10, 10, 0, 0], "p": {"a": -30, "f": [25, 40, 25]}},
    "t": {"d": [I, I, I, I], "ab": [0, 0, 0, 0], "p": {"a": -12, "f": [20, 32, 16]}},
    "u": {"d": [R, R, I, I], "ab": [0, 0, 0, 0], "p": {"a": -30, "f": [25, 40, 25]}},
}

# (forma, dir, pal)
LETRAS = {
    "a": ("a", "arriba", "adelante"),
    "b": ("b", "adentro", "abajo"),
    "c": ("c", "arriba+adelante", "adentro"),
    "d": ("d", "arriba", "adelante"),
    "e": ("pulgar", "arriba", "adelante"),
    "f": ("f", "arriba", "adelante"),
    "g": ("g", "adentro", "abajo"),
    "h": ("h", "adentro", "abajo"),
    "i": ("i", "arriba", "adelante"),
    "k": ("k", "arriba", "adelante"),
    "l": ("l", "arriba", "adelante"),
    "m": ("m", "abajo", "atras"),
    "n": ("n", "abajo", "atras"),
    "o": ("o", "arriba+adelante", "adentro"),
    "p": ("p", "arriba", "adelante"),
    "q": ("piña", "abajo+adentro", "atras"),
    "r": ("r", "arriba", "adelante"),
    "s": ("puño", "arriba", "adelante"),
    "t": ("t", "arriba", "adelante"),
    "u": ("u", "arriba", "adelante"),
    "v": ("v", "arriba", "adelante"),
    "w": ("w", "arriba", "adelante"),
    "x": ("gancho", "arriba", "adelante"),
    "y": ("y", "arriba", "adelante"),
}


def clave(t, forma, direccion, pal, desp=(0, 0, 0)):
    c = {"t": t, "pos": [round(POS[0] + desp[0], 3), round(POS[1] + desp[1], 3), round(POS[2] + desp[2], 3)],
         "dir": direccion, "pal": pal, "forma": FORMAS.get(forma, forma), "punto": "palma"}
    return c


def letra_quieta(forma, direccion, pal):
    return {"dur": 0.5, "d": [clave(0, forma, direccion, pal), {"t": 1, "pos": list(POS)}]}


def main():
    letras = {l: letra_quieta(*v) for l, v in LETRAS.items()}
    # J: el meñique dibuja una J.
    letras["j"] = {"dur": 0.6, "d": [
        clave(0, "i", "arriba", "adelante", (0, 0.06, 0)),
        {"t": 0.5, "pos": [POS[0], POS[1] - 0.1, POS[2]], "dir": "abajo+adelante"},
        {"t": 1, "pos": [POS[0] - 0.08, POS[1] - 0.12, POS[2]], "dir": "arriba+adentro"},
    ]}
    # Ñ: la N con un vaivén lateral.
    letras["ñ"] = {"dur": 0.6, "d": [
        clave(0, "n", "abajo", "atras", (-0.05, 0, 0)),
        {"t": 0.5, "pos": [POS[0] + 0.07, POS[1], POS[2]]},
        {"t": 1, "pos": [POS[0] - 0.05, POS[1], POS[2]]},
    ]}
    # Z: el índice dibuja una Z.
    letras["z"] = {"dur": 0.7, "d": [
        clave(0, "indice", "adelante+arriba", "abajo", (-0.07, 0.07, 0)),
        {"t": 0.3, "pos": [POS[0] + 0.07, POS[1] + 0.07, POS[2]]},
        {"t": 0.65, "pos": [POS[0] - 0.07, POS[1] - 0.07, POS[2]]},
        {"t": 1, "pos": [POS[0] + 0.07, POS[1] - 0.07, POS[2]]},
    ]}
    for l, s in letras.items():
        s["nm"] = {"necesita": {"cuerpo": False, "cara": False, "ojos": False}, "nota": "Letra del alfabeto dactilológico."}
    with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"nota": "Alfabeto dactilológico propio. Letras descritas con el modelo de mano a partir del manual básico de LSE (referencia). Borrador sin validar.",
                   "letras": letras}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(len(letras), "letras ->", SALIDA)


if __name__ == "__main__":
    main()
