"""Descarga los vídeos de signos LSE de ARASAAC como material de referencia.

ARASAAC (Gobierno de Aragón) publica un vídeo corto por cada acepción de unas 3.700
palabras, con licencia Creative Commons BY-NC-SA (uso sin ánimo de lucro, citando la
fuente y compartiendo igual). No hay API para esto: el índice palabra -> vídeo va
dentro de un fichero JavaScript de su web, que aquí se lee como texto (no se ejecuta).

Uso:
    py herramientas\\descargar_arasaac.py              índice + vídeos (se puede cortar y reanudar)
    py herramientas\\descargar_arasaac.py --solo-indice
    py herramientas\\descargar_arasaac.py --datos fichero.js   (si la dirección del índice ha cambiado)

Deja todo en referencia\\arasaac\\ :  indice.json, CREDITOS.txt y videos\\<id>.mp4
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "referencia", "arasaac")
# El nombre de este fichero cambia cada vez que ARASAAC publica su web.
URL_DATOS = "https://arasaac.org/23.632fa8b0609d424a0421.chunk.js"
URL_VIDEO = "https://static.arasaac.org/lse-acepciones/{}.mp4"
CABECERAS = {"User-Agent": "Mozilla/5.0 (compatible; lse-reference-fetch)"}
TIPO_VIDEO, TIPO_FOTO = 11, 12

CREDITOS = """Vídeos de signos de lengua de signos española (LSE) descargados de ARASAAC.

Origen:   ARASAAC, Centro Aragonés para la Comunicación Aumentativa y Alternativa
          (https://arasaac.org), Gobierno de Aragón.
Licencia: Creative Commons BY-NC-SA. Se autoriza su uso para fines sin ánimo de lucro
          siempre que se cite la fuente y el autor y se comparta bajo la misma licencia.
          Queda excluido el uso comercial.
Descarga: {fecha}. {videos} vídeos de {palabras} palabras o expresiones.

Se usan en este proyecto solo como referencia de cómo se realiza cada signo.
"""


def pedir(url, intentos=3):
    for n in range(intentos):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=CABECERAS), timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            ultimo = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            ultimo = e
        time.sleep(2 * (n + 1))
    raise RuntimeError(f"{url}: {ultimo}")


def leer_indice(texto):
    """Extrae del JavaScript de ARASAAC el diccionario palabra -> acepciones."""
    inicio = texto.find("lseData.js")
    inicio = texto.find("={", inicio)
    if inicio < 0:
        sys.exit("No encuentro los datos de LSE en el fichero: la web de ARASAAC ha cambiado.")
    cadena = r'"((?:[^"\\]|\\.)*)"'
    clave = re.compile(r'[{,](?:' + cadena + r'|([\w$À-ÿ]+)):\[(?=\{desc:)')
    acepcion = re.compile(r'\{desc:' + cadena + r',items:\[(.*?)\],idPalabra:"(\d+)"\}')
    elemento = re.compile(r'\{idImagen:(\d+),tipo:(\d+)\}')

    palabras, marcas = {}, list(clave.finditer(texto, inicio))
    for k, m in enumerate(marcas):
        fin = marcas[k + 1].start() if k + 1 < len(marcas) else len(texto)
        bloque = texto[m.end():fin]
        if k + 1 == len(marcas):                      # la última palabra: corta donde acaba su lista
            bloque = bloque[:bloque.find("}]}") + 2]
        nombre = json.loads('"' + m.group(1) + '"') if m.group(1) is not None else m.group(2)
        acepciones = []
        for a in acepcion.finditer(bloque):
            descripcion = json.loads('"' + a.group(1) + '"')
            elementos = [(int(i), int(t)) for i, t in elemento.findall(a.group(2))]
            acepciones.append({
                "id": a.group(3),
                "pista": descripcion[:90],             # solo para distinguir acepciones
                "videos": [i for i, t in elementos if t == TIPO_VIDEO],
                "fotos": [i for i, t in elementos if t == TIPO_FOTO],
            })
        if acepciones:
            palabras[nombre] = acepciones
    return palabras


def bajar_video(ident):
    ruta = os.path.join(DESTINO, "videos", f"{ident}.mp4")
    if os.path.isfile(ruta) and os.path.getsize(ruta) > 0:
        return "ya"
    datos = pedir(URL_VIDEO.format(ident))
    if not datos:
        return "falta"
    with open(ruta + ".part", "wb") as f:
        f.write(datos)
    os.replace(ruta + ".part", ruta)
    return "nuevo"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", help="fichero .js de ARASAAC ya descargado")
    ap.add_argument("--solo-indice", action="store_true")
    args = ap.parse_args()
    os.makedirs(os.path.join(DESTINO, "videos"), exist_ok=True)

    if args.datos:
        with open(args.datos, encoding="utf-8") as f:
            texto = f.read()
    else:
        crudo = pedir(URL_DATOS)
        if not crudo:
            sys.exit("La dirección del índice de ARASAAC ya no existe; pásalo con --datos.")
        texto = crudo.decode("utf-8")
    palabras = leer_indice(texto)
    videos = sorted({v for acepciones in palabras.values() for a in acepciones for v in a["videos"]})
    with open(os.path.join(DESTINO, "indice.json"), "w", encoding="utf-8") as f:
        json.dump({"fuente": "ARASAAC (https://arasaac.org), Gobierno de Aragón. Licencia CC BY-NC-SA.",
                   "descarga": date.today().isoformat(), "palabras": palabras}, f, ensure_ascii=False)
    with open(os.path.join(DESTINO, "CREDITOS.txt"), "w", encoding="utf-8") as f:
        f.write(CREDITOS.format(fecha=date.today().isoformat(), videos=len(videos), palabras=len(palabras)))
    print(f"Índice: {len(palabras)} palabras, {sum(len(a) for a in palabras.values())} acepciones, {len(videos)} vídeos", flush=True)
    if args.solo_indice:
        return

    cuenta = {"ya": 0, "nuevo": 0, "falta": 0, "error": 0}
    with ThreadPoolExecutor(3) as grupo:               # pocas descargas a la vez, por cortesía con el servidor
        tareas = {grupo.submit(bajar_video, v): v for v in videos}
        for n, tarea in enumerate(as_completed(tareas), 1):
            try:
                cuenta[tarea.result()] += 1
            except Exception as e:                     # un fallo no detiene el resto; al relanzar se reintenta
                cuenta["error"] += 1
                print("  error", tareas[tarea], e, flush=True)
            if n % 200 == 0 or n == len(videos):
                print(f"  {100 * n / len(videos):5.1f}%  {n}/{len(videos)}  nuevos {cuenta['nuevo']}, "
                      f"ya estaban {cuenta['ya']}, no existen {cuenta['falta']}, errores {cuenta['error']}", flush=True)
    total = sum(os.path.getsize(os.path.join(DESTINO, "videos", f)) for f in os.listdir(os.path.join(DESTINO, "videos")))
    print(f"Listo: {total / 1e6:.0f} MB en {os.path.join(DESTINO, 'videos')}")


if __name__ == "__main__":
    main()
