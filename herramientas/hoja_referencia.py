"""Genera hojas de consulta de los vídeos de referencia para describir signos con la notación propia.

Cada fila es una palabra y muestra ocho fotogramas del vídeo de referencia (media figura, de arriba
a abajo en el orden de reproducción). Sirve SOLO para consultar cómo se hace el signo; no se
distribuye ni forma parte del producto.

Uso:
    py herramientas\\hoja_referencia.py --salida carpeta  palabra1 palabra2 ...
    py herramientas\\hoja_referencia.py --salida carpeta  --archivo lista.txt
Salida: carpeta\\hoja_01.png, hoja_02.png ... (4 palabras por hoja) y carpeta\\hojas.json
"""
import argparse
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
from texto import normalizar  # noqa: E402

COLUMNAS, ANCHO, ALTO = 8, 150, 169
POR_HOJA = 4


def cargar_indice():
    ruta = os.path.join(RAIZ, "referencia", "arasaac", "indice.json")
    with open(ruta, encoding="utf-8") as f:
        palabras = json.load(f)["palabras"]
    por_clave = {}
    for palabra, acepciones in palabras.items():
        por_clave.setdefault(normalizar(palabra), (palabra, acepciones))
    return por_clave


def fotogramas(video, destino):
    """Ocho fotogramas repartidos por el vídeo, recortados a media figura, en una tira."""
    filtro = f"fps=2.7,crop=480:540:120:0,scale={ANCHO}:{ALTO},tile={COLUMNAS}x1"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-vf", filtro, "-frames:v", "1", destino], check=True)
    return Image.open(destino).convert("RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("palabras", nargs="*")
    ap.add_argument("--archivo", help="fichero con una palabra por línea")
    ap.add_argument("--salida", required=True)
    args = ap.parse_args()
    lista = list(args.palabras)
    if args.archivo:
        with open(args.archivo, encoding="utf-8") as f:
            lista += [l.strip() for l in f if l.strip() and not l.startswith("#")]
    os.makedirs(args.salida, exist_ok=True)
    indice = cargar_indice()
    fuente = ImageFont.truetype("arial.ttf", 17)

    filas, hojas = [], []
    for palabra in lista:
        hallada = indice.get(normalizar(palabra))
        if not hallada:
            print(f"  sin vídeo de referencia: {palabra}")
            continue
        nombre, acepciones = hallada
        acepcion = next((a for a in acepciones if a["videos"]), None)
        if not acepcion:
            print(f"  sin vídeo de referencia: {palabra}")
            continue
        video = os.path.join(RAIZ, "referencia", "arasaac", "videos", f"{acepcion['videos'][0]}.mp4")
        if not os.path.isfile(video):
            print(f"  vídeo no descargado: {palabra} ({acepcion['videos'][0]})")
            continue
        tira = fotogramas(video, os.path.join(args.salida, "_tira.png"))
        filas.append((palabra, acepcion["pista"], tira, len(acepciones)))
    for k in range(0, len(filas), POR_HOJA):
        grupo = filas[k:k + POR_HOJA]
        hoja = Image.new("RGB", (COLUMNAS * ANCHO, len(grupo) * (ALTO + 26)), "white")
        d = ImageDraw.Draw(hoja)
        for i, (palabra, pista, tira, n_ac) in enumerate(grupo):
            y = i * (ALTO + 26)
            hoja.paste(tira, (0, y + 26))
            extra = f"  [+{n_ac - 1} acepciones; esta es la primera]" if n_ac > 1 else ""
            d.text((4, y + 3), f"{palabra}{extra}  —  {pista}", fill=(190, 0, 0), font=fuente)
        ruta = os.path.join(args.salida, f"hoja_{k // POR_HOJA + 1:02d}.png")
        hoja.save(ruta)
        hojas.append({"hoja": ruta, "palabras": [f[0] for f in grupo]})
    ruta_tira = os.path.join(args.salida, "_tira.png")
    if os.path.exists(ruta_tira):
        os.remove(ruta_tira)
    with open(os.path.join(args.salida, "hojas.json"), "w", encoding="utf-8") as f:
        json.dump(hojas, f, ensure_ascii=False, indent=1)
    print(f"{len(filas)} palabras en {len(hojas)} hojas -> {args.salida}")


if __name__ == "__main__":
    main()
