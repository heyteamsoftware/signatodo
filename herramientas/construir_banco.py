"""Construye el banco de tarjetas (banco/) a partir de los dos PDF de la carpeta.

  - Signos: dibujos del "Diccionario básico de LSE" (una tarjeta por dibujo).
  - Dactilológico: manos del "Manual básico", redibujadas a línea negra sobre
    blanco para que tengan el mismo estilo que los signos del diccionario.

Todas las tarjetas salen con el mismo lienzo, fondo y tipografía.

Uso:  py herramientas\\construir_banco.py
"""
import glob
import io
import json
import os
import re
import sys

import numpy as np
import pymupdf
import simplemma
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texto import normalizar  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = os.path.join(RAIZ, "banco")
LIENZO = (600, 560)          # tamaño único de todas las tarjetas
FUENTE = "timesbd.ttf"       # la misma letra (Times negrita) que usa el diccionario
CUERPO = 44

# Etiquetas del diccionario que no son una palabra simple: claves por las que se buscan.
CLAVES_ESPECIALES = {
    "ABRIR LOS GRIFOS": ["ABRIR LOS GRIFOS", "ABRIR EL GRIFO"],
    "ATENDER, CUIDAR": ["ATENDER", "CUIDAR"],
    "BAÑO, CUARTO DE": ["CUARTO DE BAÑO", "BAÑO"],
    "CONTAR, EXPLICAR": ["EXPLICAR", "CONTAR"],
    "DAR, ASCO": ["DAR ASCO"],
    "DIARIO, A": ["A DIARIO", "DIARIO"],
    "DOLOR/DOLER": ["DOLOR", "DOLER"],
    "HOJAS (ARBOL)": ["HOJAS", "HOJA"],
    "JUGUETES (VARIOS)": ["JUGUETES"],
    "LLENO (COMIDA)": ["LLENO"],
    "MAÑANA (POR LA...)": ["POR LA MAÑANA"],
    "NUEVO (MODERNO)": ["NUEVO", "MODERNO"],
    "PERSONA (S)": ["PERSONAS"],
    "¿POR QUE?": ["POR QUE", "PORQUE"],
    "RAPIDAMENTE, RAPIDO": ["RAPIDO", "RAPIDAMENTE"],
    "REGALAR, REGALO": ["REGALAR", "REGALO"],
    "SENTARSE/SILLA": ["SENTARSE", "SILLA"],
    "TU, TE": ["TU", "TE"],
    "ZAPATO (CALZADO)": ["ZAPATO"],
    "PORTERO (FUTBOL)": ["PORTERO DE FUTBOL"],
    "DEBE": ["DEBER"],
    "TIEMPO CRONOLOGICO": ["TIEMPO CRONOLOGICO", "TIEMPO"],
    "FUERA DE LA CASA": ["FUERA DE LA CASA", "FUERA"],
    "NOCHE VIEJA": ["NOCHE VIEJA", "NOCHEVIEJA"],
    "SPAGUETTI": ["SPAGUETTI", "ESPAGUETI", "ESPAGUETIS"],
    "SANDWICHES": ["SANDWICHES", "SANDWICH"],
    "PING-PONG": ["PING PONG", "PINGPONG"],
    "MAMA": ["MAMA", "MADRE"],
    "PAPA": ["PAPA", "PADRE"],
}

# Palabras que solo corresponden al signo si llevan tilde ("sí" frente a "si").
SOLO_CON_TILDE = {"SI": "sí", "QUE": "qué", "MAS": "más", "BEBE": "bebé"}


def orden_lectura(pagina, ancho_minimo):
    infos = [m for m in pagina.get_image_info(xrefs=True) if m["width"] >= ancho_minimo]
    infos.sort(key=lambda m: (round(m["bbox"][1] / 40), m["bbox"][0]))
    return infos


def imagen(doc, xref):
    return Image.open(io.BytesIO(doc.extract_image(xref)["image"])).convert("RGB")


def guardar(img, ruta):
    """Guarda la tarjeta en grises con pocos tonos: mismo aspecto y archivos pequeños."""
    img.convert("L").quantize(16).save(ruta, optimize=True)


def en_lienzo(img, apaisada=False):
    """Centra la imagen en el lienzo común, reduciéndola o ampliándola si hace falta."""
    if apaisada:                                         # recorta el margen en blanco para que el dibujo se vea grande
        tinta = np.asarray(img.convert("L")) < 200
        filas, cols = np.where(tinta.any(axis=1))[0], np.where(tinta.any(axis=0))[0]
        img = img.crop((max(cols[0] - 12, 0), max(filas[0] - 12, 0), min(cols[-1] + 13, img.width), min(filas[-1] + 13, img.height)))
    escala = min((LIENZO[0] - 20) / img.width, (LIENZO[1] - 20) / img.height)
    if escala < 1 or escala > 1.4:
        escala = min(escala, 3.0)
        img = img.resize((round(img.width * escala), round(img.height * escala)), Image.LANCZOS)
    lienzo = Image.new("RGB", LIENZO, "white")
    lienzo.paste(img, ((LIENZO[0] - img.width) // 2, (LIENZO[1] - img.height) // 2))
    return lienzo


def slug(etiqueta):
    s = normalizar(etiqueta).lower().replace("ñ", "ny")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def claves_de(etiqueta):
    """Devuelve (claves exactas, claves derivadas) para una etiqueta del diccionario."""
    exactas = [normalizar(c) for c in CLAVES_ESPECIALES.get(etiqueta, [etiqueta])]
    derivadas = []
    for clave in exactas:
        if " " in clave:
            continue
        if re.search(r"(AR|ER|IR)SE$", clave):          # BAÑARSE -> BAÑAR
            derivadas.append(clave[:-2])
        lema = normalizar(simplemma.lemmatize(clave.lower(), lang="es"))
        if lema and lema != clave:                        # BRAZOS -> BRAZO
            derivadas.append(lema)
    return exactas, derivadas


def construir_signos():
    pdf = [f for f in glob.glob(os.path.join(RAIZ, "*.pdf")) if os.path.basename(f).lower().startswith("diccionario")][0]
    doc = pymupdf.open(pdf)
    etiquetas = {}
    with open(os.path.join(RAIZ, "herramientas", "etiquetas_diccionario.tsv"), encoding="utf-8") as f:
        for linea in f:
            if not linea.startswith("#") and "\t" in linea:
                nombre, etiqueta = linea.rstrip("\n").split("\t")
                etiquetas[nombre] = etiqueta

    os.makedirs(os.path.join(BANCO, "signos"), exist_ok=True)
    tarjetas, pendientes = {}, []
    for n_pag in range(2, len(doc)):
        for k, info in enumerate(orden_lectura(doc[n_pag], 150)):
            nombre = f"p{n_pag + 1:03d}_{k + 1}"
            etiqueta = etiquetas.get(nombre)
            if not etiqueta:
                print("  sin etiqueta:", nombre)
                continue
            img = imagen(doc, info["xref"])
            ident = base = slug(etiqueta)
            n = 2
            while ident in tarjetas:
                ident = f"{base}-{n}"
                n += 1
            apaisada = img.width > img.height * 1.6     # dibujos en dos pasos, más pequeños
            guardar(en_lienzo(img, apaisada), os.path.join(BANCO, "signos", ident + ".png"))
            tarjetas[ident] = {"etiqueta": etiqueta, "archivo": f"signos/{ident}.png", "pagina": n_pag + 1}
            pendientes.append((apaisada, ident, etiqueta))

    claves, con_tilde = {}, {}
    pendientes.sort(key=lambda t: t[0])                  # las tarjetas grandes tienen preferencia
    for pasada in (0, 1):                                # primero claves exactas, luego derivadas
        for _, ident, etiqueta in pendientes:
            for clave in claves_de(etiqueta)[pasada]:
                if clave in SOLO_CON_TILDE:
                    con_tilde.setdefault(SOLO_CON_TILDE[clave], ident)
                else:
                    claves.setdefault(clave, ident)
    return tarjetas, claves, con_tilde


def mano_a_linea(img):
    """Convierte una mano a color en dibujo de línea negra sobre blanco (como el diccionario)."""
    a = np.asarray(img).astype(np.float32)
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    tinta = np.clip((165 - mx) / 70, 0, 1)               # solo los trazos oscuros...
    tinta *= np.clip((0.62 - sat) / 0.2, 0, 1)           # ...y sin color (fuera la letra verde)
    tinta[:6, :] = 0
    gris = Image.fromarray((255 * (1 - tinta)).astype(np.uint8))
    mascara = np.asarray(gris) < 128
    filas, cols = np.where(mascara.any(axis=1))[0], np.where(mascara.any(axis=0))[0]
    gris = gris.crop((cols[0], filas[0], cols[-1] + 1, filas[-1] + 1))
    return gris


def tarjeta_letra(mano, letra, flecha=False):
    escala = min(400 / mano.width, 400 / mano.height, 1.6)
    mano = mano.resize((round(mano.width * escala), round(mano.height * escala)), Image.LANCZOS)
    mano = mano.filter(ImageFilter.GaussianBlur(1.2))    # trazo continuo, del grosor del diccionario
    mano = mano.point(lambda v: 0 if v < 150 else (255 if v > 225 else int((v - 150) * 255 / 75)))
    lienzo = Image.new("L", LIENZO, 255)
    x, y = (LIENZO[0] - mano.width) // 2 - 20, (LIENZO[1] - mano.height) // 2 - 20
    lienzo.paste(mano, (x, y))
    d = ImageDraw.Draw(lienzo)
    if flecha:                                           # la Ñ es la N con vaivén lateral
        fy, x0, x1 = y + mano.height + 26, LIENZO[0] // 2 - 90, LIENZO[0] // 2 + 50
        d.line((x0, fy, x1, fy), fill=0, width=5)
        d.polygon([(x0 - 16, fy), (x0 + 6, fy - 12), (x0 + 6, fy + 12)], fill=0)
        d.polygon([(x1 + 16, fy), (x1 - 6, fy - 12), (x1 - 6, fy + 12)], fill=0)
    fuente = ImageFont.truetype(FUENTE, CUERPO)
    d.text((LIENZO[0] - 44, LIENZO[1] - 34), letra.upper(), fill=0, font=fuente, anchor="rs")
    return lienzo.convert("RGB")


def construir_dactilologico():
    pdf = [f for f in glob.glob(os.path.join(RAIZ, "*.pdf")) if os.path.basename(f).upper().startswith("MANUAL")][0]
    doc = pymupdf.open(pdf)
    manos = []
    for n_pag in range(18, 23):                          # páginas 19-23: letras a-z en orden
        for info in sorted(doc[n_pag].get_image_info(xrefs=True), key=lambda m: m["bbox"][1]):
            if info["width"] > 200:                      # descarta la banda decorativa lateral
                manos.append(mano_a_linea(imagen(doc, info["xref"])))
    abecedario = "abcdefghijklmnopqrstuvwxyz"
    assert len(manos) == len(abecedario), len(manos)
    os.makedirs(os.path.join(BANCO, "dactilologico"), exist_ok=True)
    letras = {}
    for letra, mano in zip(abecedario, manos):
        guardar(tarjeta_letra(mano, letra), os.path.join(BANCO, "dactilologico", letra + ".png"))
        letras[letra] = f"dactilologico/{letra}.png"
        if letra == "n":
            guardar(tarjeta_letra(mano, "ñ", flecha=True), os.path.join(BANCO, "dactilologico", "ny.png"))
            letras["ñ"] = "dactilologico/ny.png"
    return letras


def main():
    tarjetas, claves, con_tilde = construir_signos()
    letras = construir_dactilologico()
    indice = {
        "fuentes": [
            "Diccionario básico de lengua de signos española, recopilado por la Asociación Equitación como Terapia",
            "Manual básico. Curso de lengua de signos española (academia-formacion.com)",
        ],
        "tarjetas": tarjetas,
        "claves": dict(sorted(claves.items())),
        "claves_con_tilde": con_tilde,
        "letras": letras,
    }
    with open(os.path.join(BANCO, "indice.json"), "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=1)
    print(f"{len(tarjetas)} tarjetas de signos, {len(claves) + len(con_tilde)} claves, {len(letras)} letras")


if __name__ == "__main__":
    main()
