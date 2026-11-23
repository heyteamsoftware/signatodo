"""Transcribe el audio de un vídeo y prepara los signos que se mostrarán en el recuadro.

Uso:
    py procesar.py videos\\mi_video.mp4
    py procesar.py videos\\mi_video.mp4 --modelo base     (más rápido, menos preciso)

Genera videos\\mi_video.signos.json, que es lo que lee el reproductor.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np

RAIZ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))

from glosador import Glosador  # noqa: E402


def cargar_audio(ruta):
    """Extrae el audio con ffmpeg (mono, 16 kHz). Si no hay ffmpeg, deja que lo lea faster-whisper."""
    orden = ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", ruta, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]
    try:
        crudo = subprocess.run(orden, capture_output=True, check=True).stdout
    except FileNotFoundError:
        return ruta
    except subprocess.CalledProcessError as e:
        sys.exit("ffmpeg no ha podido leer el audio del vídeo:\n" + e.stderr.decode("utf-8", "replace"))
    return np.frombuffer(crudo, np.int16).astype(np.float32) / 32768


def transcribir(ruta, modelo):
    from faster_whisper import WhisperModel

    audio = cargar_audio(ruta)
    print(f"Cargando el modelo de transcripción '{modelo}'...", flush=True)
    whisper = WhisperModel(modelo, device="cpu", compute_type="int8")
    segmentos, info = whisper.transcribe(audio, language="es", word_timestamps=True,
                                         vad_filter=True, beam_size=3)
    palabras = []
    for s in segmentos:
        palabras += [{"t0": p.start, "t1": p.end, "texto": p.word.strip()} for p in (s.words or []) if p.word.strip()]
        print(f"  {100 * s.end / info.duration:5.1f}%  {s.text.strip()}", flush=True)
    if isinstance(audio, np.ndarray):
        ajustar_pausas(palabras, audio)
    for p in palabras:
        p["t0"], p["t1"] = round(p["t0"], 2), round(p["t1"], 2)
    return partir_en_subtitulos(palabras), info.duration


def ajustar_pausas(palabras, audio, fs=16000):
    """Saca los silencios de dentro de las palabras.

    El transcriptor pega cada palabra a la anterior, así que una pausa entre dos palabras
    queda dentro de una de ellas y su signo entraría antes (o duraría más) de la cuenta.
    """
    paso = 0.02
    n = len(audio) // int(paso * fs)
    if n == 0:
        return
    rms = np.sqrt((audio[:n * int(paso * fs)].reshape(n, -1) ** 2).mean(axis=1))
    voz = rms > 0.08 * np.percentile(rms, 95)
    for p in palabras:
        a, b = int(p["t0"] / paso), min(int(p["t1"] / paso), n)
        if b - a < 20:                                   # en menos de 0,4 s no cabe una pausa
            continue
        tramo = voz[a:b]
        s0 = s1 = 0                                      # silencio más largo dentro de la palabra
        inicio = None
        for i, hay_voz in enumerate(list(tramo) + [True]):
            if not hay_voz and inicio is None:
                inicio = i
            elif hay_voz and inicio is not None:
                if i - inicio > s1 - s0:
                    s0, s1 = inicio, i
                inicio = None
        if s1 - s0 < 13:                                 # pausas de menos de 0,25 s no cuentan
            continue
        if tramo[s1:].sum() >= 5:                        # hay voz tras la pausa: la palabra suena después
            p["t0"] = (a + s1) * paso
        else:                                            # la palabra suena antes de la pausa
            p["t1"] = (a + s0) * paso


def partir_en_subtitulos(palabras, pausa=1.5, largo=70):
    """Agrupa las palabras en subtítulos: corta en punto final, en pausas largas o al llenarse la línea."""
    segmentos, actual = [], []
    for i, p in enumerate(palabras):
        actual.append(p)
        siguiente = palabras[i + 1] if i + 1 < len(palabras) else None
        letras = sum(len(x["texto"]) + 1 for x in actual)
        pausa_larga = siguiente is not None and siguiente["t0"] - p["t1"] >= pausa and len(actual) >= 3
        if siguiente is None or p["texto"][-1] in ".?!…" or pausa_larga or letras >= largo:
            segmentos.append({"t0": actual[0]["t0"], "t1": actual[-1]["t1"],
                              "texto": " ".join(x["texto"] for x in actual), "palabras": actual})
            actual = []
    return segmentos


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--modelo", default="small", help="tiny, base, small (por defecto) o medium")
    args = ap.parse_args()
    if not os.path.isfile(args.video):
        sys.exit(f"No encuentro el vídeo: {args.video}")

    inicio = time.time()
    segmentos, duracion = transcribir(args.video, args.modelo)

    glosador = Glosador()
    unidades = []
    for n, seg in enumerate(segmentos):
        for u in glosador.glosar(seg["palabras"]):
            unidades.append({"seg": n, **u})

    salida = os.path.splitext(args.video)[0] + ".signos.json"
    with open(salida, "w", encoding="utf-8") as f:
        json.dump({"video": os.path.basename(args.video), "duracion": round(duracion, 2), "modelo": args.modelo,
                   "segmentos": segmentos, "unidades": unidades}, f, ensure_ascii=False)

    total = len(unidades) or 1
    cuenta = {t: sum(u["tipo"] == t for u in unidades) for t in ("signo", "deletreo", "omitir")}
    print(f"\nListo en {time.time() - inicio:.0f} s  ->  {salida}")
    print(f"  con signo:   {cuenta['signo']:4d}  ({100 * cuenta['signo'] / total:.0f}%)")
    print(f"  deletreadas: {cuenta['deletreo']:4d}  ({100 * cuenta['deletreo'] / total:.0f}%)")
    print(f"  omitidas:    {cuenta['omitir']:4d}  ({100 * cuenta['omitir'] / total:.0f}%)")


if __name__ == "__main__":
    main()
