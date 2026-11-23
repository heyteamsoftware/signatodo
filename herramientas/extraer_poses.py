"""Extrae el movimiento de los vídeos de referencia de ARASAAC para animar el avatar.

De cada vídeo saca, fotograma a fotograma, la posición de hombros, codos, muñecas,
cabeza y los 21 puntos de cada mano (MediaPipe Holistic), lo normaliza (origen entre
los hombros, unidad = ancho de hombros), recorta la subida y la bajada de manos y lo
guarda como un clip compacto en banco\\poses\\<id>.json.

Necesita Python 3.12 (MediaPipe no funciona con 3.13):
    py -3.12 herramientas\\extraer_poses.py "niña" comer pan         (palabras de ARASAAC)
    py -3.12 herramientas\\extraer_poses.py --todo                    (todas; varias horas)
"""
import argparse
import json
import os
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from descargar_arasaac import bajar_video  # noqa: E402
from texto import normalizar  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEOS = os.path.join(RAIZ, "referencia", "arasaac", "videos")
POSES = os.path.join(RAIZ, "banco", "poses")
MODELO = os.path.join(RAIZ, "referencia", "modelos", "holistic_landmarker.task")
FPS = 25
# Puntos del cuerpo que se guardan, en este orden (índices de MediaPipe Pose).
CUERPO = [0, 11, 12, 13, 14, 15, 16, 23, 24]   # nariz, hombros i/d, codos i/d, muñecas i/d, caderas i/d
DISTANCIA_REPOSO = 0.3                          # muñeca a menos de esto (en anchos de hombro) del reposo = aún no signa


def puntos(lista, ancho, alto):
    """x, y en píxeles y z (profundidad: menor = más cerca de la cámara) en la misma escala."""
    return np.array([[p.x * ancho, p.y * alto, p.z * ancho] for p in lista], np.float32)


def leer_video(ruta, detector_nuevo):
    """Lee TODOS los fotogramas (el seguimiento de las manos es más fino con pasos cortos).

    Devuelve (cuerpo[n,9,3], mano_izq[n,21,3] con NaN si falta, mano_der, fotogramas por segundo).
    """
    captura = cv2.VideoCapture(ruta)
    fps = captura.get(cv2.CAP_PROP_FPS) or 25
    ancho, alto = captura.get(3), captura.get(4)
    detector = detector_nuevo()
    cuerpo, izq, der, i = [], [], [], 0
    while True:
        ok, cuadro = captura.read()
        if not ok:
            break
        imagen = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(cuadro, cv2.COLOR_BGR2RGB))
        r = detector.detect_for_video(imagen, int(i * 1000 / fps))
        if r.pose_landmarks:
            cuerpo.append(puntos(r.pose_landmarks, ancho, alto)[CUERPO])
            vacia = np.full((21, 3), np.nan, np.float32)
            izq.append(puntos(r.left_hand_landmarks, ancho, alto) if r.left_hand_landmarks else vacia)
            der.append(puntos(r.right_hand_landmarks, ancho, alto) if r.right_hand_landmarks else vacia)
        i += 1
    captura.release()
    detector.close()
    return np.array(cuerpo), np.array(izq), np.array(der), fps


def rellenar_mano(mano, muneca):
    """Rellena los fotogramas sin mano interpolando su forma (relativa a la muñeca)."""
    hay = ~np.isnan(mano[:, 0, 0])
    if hay.sum() < 3:
        return None
    desplazamiento = np.concatenate([muneca[:, None, :2], np.zeros((len(mano), 1, 1), np.float32)], axis=2)
    relativa = mano - desplazamiento                     # la z de la mano ya es relativa a su muñeca
    indices = np.arange(len(mano))
    for p in range(21):
        for eje in range(3):
            relativa[:, p, eje] = np.interp(indices, indices[hay], relativa[hay, p, eje])
    return relativa + desplazamiento


def suavizar(serie, pasadas):
    """Filtro 1-2-1 repetido: quita el temblor del seguimiento sin emborronar el gesto."""
    if serie is None:
        return None
    for _ in range(pasadas):
        if len(serie) < 3:
            break
        lisa = serie.copy()
        lisa[1:-1] = 0.25 * serie[:-2] + 0.5 * serie[1:-1] + 0.25 * serie[2:]
        serie = lisa
    return serie


def extraer(ident, detector_nuevo):
    ruta = os.path.join(VIDEOS, f"{ident}.mp4")
    if not os.path.isfile(ruta) and bajar_video(ident) == "falta":
        return None
    cuerpo, izq, der, fps = leer_video(ruta, detector_nuevo)
    if len(cuerpo) < 8:
        return None
    # Normaliza: origen entre los hombros, unidad = ancho de hombros (medianas de todo el clip).
    centro = np.append(np.median((cuerpo[:, 1, :2] + cuerpo[:, 2, :2]) / 2, axis=0), 0)
    unidad = float(np.median(np.linalg.norm(cuerpo[:, 1, :2] - cuerpo[:, 2, :2], axis=1)))
    norma = lambda a: None if a is None else (a - centro) / unidad
    izq, der = rellenar_mano(izq, cuerpo[:, 5]), rellenar_mano(der, cuerpo[:, 6])
    # Suaviza a la velocidad original del vídeo y luego se queda con 25 fotogramas por segundo.
    salto = max(1, round(fps / FPS))
    reducir = lambda a: None if a is None else suavizar(norma(a), 2 * salto - 1)[::salto]
    cuerpo, izq, der = reducir(cuerpo), reducir(izq), reducir(der)

    # Recorta la salida y la vuelta al reposo. La signante descansa con las manos juntas
    # delante del cuerpo, así que "en reposo" = muñecas cerca de donde están al empezar
    # o al acabar el vídeo; el signo es el tramo en que alguna se aleja de ahí.
    munecas = cuerpo[:, 5:7, :2]                                # [n, 2 manos, xy]
    al_empezar, al_acabar = munecas[:3].mean(axis=0), munecas[-3:].mean(axis=0)
    lejos = np.minimum(np.linalg.norm(munecas - al_empezar, axis=2),
                       np.linalg.norm(munecas - al_acabar, axis=2)).max(axis=1)
    activos = np.where(lejos > DISTANCIA_REPOSO)[0]
    if len(activos) < 4:
        return None
    a, b = max(activos[0] - 1, 0), min(activos[-1] + 2, len(cuerpo))
    entero = lambda m: None if m is None else np.round(m[a:b] * 1000).astype(int).reshape(b - a, -1).tolist()
    plano = lambda m: None if m is None else entero(m[:, :, :2])        # x, y de cada punto
    fondo = lambda m: None if m is None else entero(m[:, :, 2])         # z de cada punto
    return {"v": 2, "fps": FPS, "n": int(b - a),
            "cuerpo": plano(cuerpo), "izq": plano(izq), "der": plano(der),
            # Profundidad, para saber qué mano y qué dedos quedan delante al cruzarse:
            "zi": fondo(izq), "zd": fondo(der), "zm": entero(cuerpo[:, 5:7, 2])}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("palabras", nargs="*")
    ap.add_argument("--todo", action="store_true")
    ap.add_argument("--rehacer", action="store_true", help="vuelve a extraer aunque el clip ya exista")
    args = ap.parse_args()
    with open(os.path.join(RAIZ, "referencia", "arasaac", "indice.json"), encoding="utf-8") as f:
        arasaac = json.load(f)["palabras"]
    por_clave = {}
    for palabra, acepciones in arasaac.items():
        videos = [v for a in acepciones for v in a["videos"]]
        if videos:
            por_clave.setdefault(normalizar(palabra), videos[0])     # acepción principal

    pedidas = list(por_clave) if args.todo else [normalizar(p) for p in args.palabras]
    os.makedirs(POSES, exist_ok=True)
    ruta_indice = os.path.join(POSES, "indice.json")
    indice = json.load(open(ruta_indice, encoding="utf-8")) if os.path.isfile(ruta_indice) else {}

    opciones = lambda: vision.HolisticLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODELO), running_mode=vision.RunningMode.VIDEO)
    detector_nuevo = lambda: vision.HolisticLandmarker.create_from_options(opciones())
    for n, clave in enumerate(pedidas, 1):
        ident = por_clave.get(clave)
        if ident is None:
            print(f"  sin vídeo en ARASAAC: {clave}", flush=True)
            continue
        destino = os.path.join(POSES, f"{ident}.json")
        if args.rehacer or not os.path.isfile(destino):
            clip = extraer(ident, detector_nuevo)
            if clip is None:
                print(f"  no se pudo extraer: {clave} ({ident})", flush=True)
                continue
            with open(destino, "w", encoding="utf-8") as f:
                json.dump(clip, f, separators=(",", ":"))
        indice[clave] = ident
        print(f"  {n}/{len(pedidas)}  {clave} -> {ident}", flush=True)
        if n % 25 == 0 or n == len(pedidas):
            with open(ruta_indice, "w", encoding="utf-8") as f:
                json.dump(indice, f, ensure_ascii=False, separators=(",", ":"))
    with open(ruta_indice, "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(indice)} signos con movimiento en {POSES}")


if __name__ == "__main__":
    main()
