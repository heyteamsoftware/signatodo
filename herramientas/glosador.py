"""Convierte palabras en español (con sus tiempos) en unidades para el recuadro de signos.

Cada unidad es de uno de estos tipos:
  - "signo":    hay tarjeta en el banco para la palabra o la expresión.
  - "deletreo": no hay signo; se deletrea con el alfabeto dactilológico.
  - "omitir":   artículos, preposiciones y demás palabras que no se signan.

OJO: esto es español signado palabra a palabra, no gramática de LSE.
"""
import json
import os
import re

import simplemma

from texto import normalizar

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Palabras funcionales que no se signan (si no tienen tarjeta propia).
OMITIR = set("""
EL LA LOS LAS LO UN UNA UNOS UNAS AL DEL
A ANTE BAJO CABE DE DESDE EN ENTRE HACIA HASTA PARA POR SEGUN SIN SO SOBRE TRAS DURANTE MEDIANTE
Y E O U NI QUE SI COMO PUES AUNQUE SINO PORQUE MAS
ME SE NOS OS LE LES MI MIS SU SUS
ES SON ERA ERAN FUE FUERON SOY ERES SOMOS SOIS SEA SEAN SIDO SIENDO
HE HAS HA HEMOS HABEIS HAN HABIA HABIAN HABER HABIDO
MUY TAN ASI
""".split())

UNIDADES = "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte".split()
DECENAS = {30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta", 70: "setenta", 80: "ochenta", 90: "noventa"}
CENTENAS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos",
            6: "seiscientos", 7: "setecientos", 8: "ochocientos", 9: "novecientos"}


def numero_a_palabras(n):
    """Número (0-9999) a palabras; los mayores se leen cifra a cifra."""
    if n > 9999:
        return [UNIDADES[int(c)] for c in str(n)]
    if n <= 20:
        return [UNIDADES[n]]
    if n < 30:
        return ["veinti" + UNIDADES[n - 20]]
    if n < 100:
        d, u = divmod(n, 10)
        return [DECENAS[d * 10]] + (["y", UNIDADES[u]] if u else [])
    if n == 100:
        return ["cien"]
    if n < 1000:
        c, r = divmod(n, 100)
        return [CENTENAS[c]] + (numero_a_palabras(r) if r else [])
    m, r = divmod(n, 1000)
    return ([] if m == 1 else numero_a_palabras(m)) + ["mil"] + (numero_a_palabras(r) if r else [])


class Glosador:
    def __init__(self, ruta_indice=None):
        ruta_indice = ruta_indice or os.path.join(RAIZ, "banco", "indice.json")
        with open(ruta_indice, encoding="utf-8") as f:
            indice = json.load(f)
        self.claves = indice["claves"]
        self.con_tilde = indice["claves_con_tilde"]
        self.letras = indice["letras"]
        self.max_frase = max(len(c.split()) for c in self.claves)
        self.primeras = {c.split()[0] for c in self.claves if " " in c}

    @staticmethod
    def _limpiar(texto):
        return re.sub(r"[^0-9a-záéíóúüñ]+", "", texto.lower())

    def _lema(self, limpio):
        return normalizar(simplemma.lemmatize(limpio, lang="es"))

    def _frase(self, fichas, i):
        """Busca la expresión más larga del banco que empiece en la ficha i."""
        norm, lema = fichas[i]["norm"], fichas[i]["lema"]
        if norm not in self.primeras and lema not in self.primeras:
            return None
        for n in range(min(self.max_frase, len(fichas) - i), 1, -1):
            resto = " ".join(f["norm"] for f in fichas[i + 1:i + n])
            for primera in (norm, lema):
                tarjeta = self.claves.get(f"{primera} {resto}")
                if tarjeta:
                    return n, tarjeta
        return None

    def _una(self, ficha):
        limpio, norm = ficha["limpio"], ficha["norm"]
        tarjeta = self.con_tilde.get(limpio) or self.claves.get(norm)
        if not tarjeta and norm not in OMITIR:
            tarjeta = self.claves.get(ficha["lema"])
        if tarjeta:
            return {"tipo": "signo", "tarjeta": tarjeta}
        if norm in OMITIR:
            return {"tipo": "omitir"}
        letras = [c for c in normalizar(limpio).lower() if c in self.letras]
        if not letras:
            return {"tipo": "omitir"}
        return {"tipo": "deletreo", "letras": letras}

    def glosar(self, palabras):
        """palabras: lista de {"t0", "t1", "texto"}. Devuelve la lista de unidades."""
        fichas = []
        for p in palabras:
            limpio = self._limpiar(p["texto"])
            if not limpio:
                continue
            if limpio.isdigit():                         # "25" -> veinticinco, repartido en su tiempo
                partes = numero_a_palabras(int(limpio))
                paso = (p["t1"] - p["t0"]) / len(partes)
                for k, parte in enumerate(partes):
                    fichas.append({"t0": p["t0"] + k * paso, "t1": p["t0"] + (k + 1) * paso,
                                   "texto": parte, "limpio": parte, "norm": normalizar(parte)})
            else:
                fichas.append({"t0": p["t0"], "t1": p["t1"], "texto": p["texto"].strip(),
                               "limpio": limpio, "norm": normalizar(limpio)})
        for f in fichas:
            f["lema"] = self._lema(f["limpio"])

        unidades, i = [], 0
        while i < len(fichas):
            frase = self._frase(fichas, i)
            if frase:
                n, tarjeta = frase
                grupo = fichas[i:i + n]
                unidades.append({"t0": grupo[0]["t0"], "t1": grupo[-1]["t1"],
                                 "texto": " ".join(f["texto"] for f in grupo), "tipo": "signo", "tarjeta": tarjeta})
                i += n
                continue
            f = fichas[i]
            unidades.append({"t0": f["t0"], "t1": f["t1"], "texto": f["texto"], "lema": f["lema"].lower(), **self._una(f)})
            i += 1
        for u in unidades:
            u["t0"], u["t1"] = round(u["t0"], 2), round(u["t1"], 2)
        return unidades
