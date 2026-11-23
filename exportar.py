"""Genera un mp4 con el recuadro de signos y los subtítulos pegados al vídeo, igual que se ven en el reproductor.

Uso:
    py exportar.py videos\\mi_video.mp4
    py exportar.py videos\\mi_video.mp4 --ancho 30 --sin-deletreo --sin-subtitulos

El vídeo tiene que estar procesado (videos\\mi_video.signos.json). Escribe exportados\\mi_video-signos.mp4.

Cómo lo hace: calcula en qué instantes cambia lo que se ve (tarjeta, reposo, subtítulo o palabra resaltada),
dibuja con Pillow una imagen transparente por cada cambio (no una por fotograma) y se las pasa a ffmpeg con
su duración para que las superponga al vídeo original.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

RAIZ = os.path.dirname(os.path.abspath(__file__))

# ---------- Línea de tiempo (copia de web/app.js) ----------
#
# OJO: RITMO, construir_linea(), indice_en() y subtitulo_en() son la traducción a Python de RITMO,
# construirLinea(), indiceEn() y pintarSubtitulos() de web/app.js. Si se cambia algo en un sitio hay que
# cambiarlo también en el otro, o el vídeo exportado dejará de coincidir con el reproductor.

# Tiempos (en segundos) con los que se reparten las tarjetas.
RITMO = {
    "signo": 0.60,          # mínimo que se ve un signo antes de pasar al siguiente
    "letra": 0.30,          # cada letra del deletreo
    "signoRapido": 0.40,    # si vamos con retraso respecto al audio
    "letraRapida": 0.17,
    "retraso": 0.8,         # a partir de aquí se acelera
    "retrasoMaximo": 3.5,   # a partir de aquí se salta el deletreo para alcanzar al audio
    "permanencia": 1.6,     # lo que aguanta la última tarjeta antes de pasar a reposo
}
MARGEN_SUBTITULO = (0.15, 0.6)   # el subtítulo entra un poco antes de su primera palabra y sale un poco después


def sin_puntuacion(texto):
    return re.sub(r'[¿?¡!.,;:"«»()]', "", texto).strip()


def construir_linea(unidades, banco, deletrear=True):
    """Tarjetas con su instante de entrada (t) y hasta cuándo aguantan si no entra otra (fin)."""
    linea = []
    cursor = 0
    for u in unidades:
        if u["tipo"] == "omitir":
            continue
        if u["tipo"] == "deletreo" and not deletrear:
            continue
        inicio = max(u["t0"], cursor)
        retraso = inicio - u["t0"]
        con_prisa = retraso > RITMO["retraso"]
        if u["tipo"] == "signo":
            dura = RITMO["signoRapido"] if con_prisa else RITMO["signo"]
            linea.append({"t": inicio, "fin": inicio + RITMO["permanencia"], "tipo": "signo",
                          "imagen": banco["tarjetas"].get(u["tarjeta"], {}).get("archivo"),
                          "texto": sin_puntuacion(u["texto"])})
            cursor = inicio + dura
        else:
            if retraso > RITMO["retrasoMaximo"]:
                continue
            paso = RITMO["letraRapida"] if con_prisa else RITMO["letra"]
            letras = u["letras"]
            for k, letra in enumerate(letras):
                ultima = k == len(letras) - 1
                linea.append({"t": inicio + k * paso, "fin": inicio + (k + 1) * paso + (0.9 if ultima else 0),
                              "tipo": "deletreo", "imagen": banco["letras"].get(letra),
                              "letras": letras, "posicion": k})
            cursor = inicio + len(letras) * paso
    return linea


def indice_en(linea, t):
    """Última tarjeta que ya ha entrado en el instante t (búsqueda binaria); -1 = reposo."""
    a, b, r = 0, len(linea) - 1, -1
    while a <= b:
        m = (a + b) >> 1
        if linea[m]["t"] <= t:
            r, a = m, m + 1
        else:
            b = m - 1
    return r if r >= 0 and t <= linea[r]["fin"] else -1


def subtitulo_en(segmentos, t):
    """(índice del subtítulo visible o -1, índices de sus palabras resaltadas)."""
    n = -1
    for i, s in enumerate(segmentos):
        if s["t0"] - MARGEN_SUBTITULO[0] <= t <= s["t1"] + MARGEN_SUBTITULO[1]:
            n = i
    if n < 0:
        return -1, ()
    palabras = segmentos[n]["palabras"]
    ahora = tuple(k for k, p in enumerate(palabras)
                  if p["t0"] <= t < (palabras[k + 1]["t0"] if k + 1 < len(palabras) else p["t1"]))
    return n, ahora


def calcular_tramos(linea, segmentos, con_subtitulos, duracion):
    """Parte el vídeo en tramos [t0, t1) durante los que no cambia nada de lo que se dibuja.

    Devuelve una lista de (t0, t1, tarjeta, subtitulo, resaltadas) con los tiempos en milisegundos.
    """
    cortes = {0.0, duracion}
    for item in linea:
        cortes.update((item["t"], item["fin"]))
    if con_subtitulos:
        for s in segmentos:
            cortes.update((s["t0"] - MARGEN_SUBTITULO[0], s["t1"] + MARGEN_SUBTITULO[1]))
            cortes.update(p["t0"] for p in s["palabras"])
            if s["palabras"]:
                cortes.add(s["palabras"][-1]["t1"])
    cortes = sorted(c for c in cortes if 0 <= c <= duracion)

    tramos = []
    for a, b in zip(cortes, cortes[1:]):
        medio = (a + b) / 2                              # entre dos cortes seguidos el estado no cambia
        estado = (indice_en(linea, medio),) + (subtitulo_en(segmentos, medio) if con_subtitulos else (-1, ()))
        a, b = round(a * 1000), round(b * 1000)
        if b <= a:
            continue
        if tramos and tramos[-1][2:] == estado:
            tramos[-1] = (tramos[-1][0], b) + estado
        else:
            tramos.append((a, b) + estado)
    return tramos


# ---------- Dibujo (copia del aspecto de web/estilo.css) ----------
#
# OJO: los colores, tipos de letra y proporciones de aquí son los de web/estilo.css (.recuadro, .tarjeta,
# .espera, .rotulo y .subtitulos). Las medidas en «cqw» del CSS son centésimas del ancho de la escena; aquí
# son centésimas de `base`. Si se cambia el estilo en un sitio hay que cambiarlo también en el otro.

PAPEL = (255, 255, 255)
TINTA = (17, 17, 17)
ACENTO = (242, 184, 75)
GRIS_ESPERA = (185, 191, 200)
OPACIDAD_REPOSO = 0.55
OPACIDAD_LETRA = 0.45
FONDO_SUBTITULO = round(0.78 * 255)
FINO = 4                                                 # las esquinas redondeadas se dibujan a 4x y se reducen

FUENTES_ROTULO = (r"C:\Windows\Fonts\timesbd.ttf", "timesbd.ttf", "Times New Roman Bold.ttf",
                  "LiberationSerif-Bold.ttf", "DejaVuSerif-Bold.ttf")
FUENTES_TEXTO = (r"C:\Windows\Fonts\segoeui.ttf", "segoeui.ttf", "Arial.ttf", "LiberationSans-Regular.ttf",
                 "DejaVuSans.ttf")


def cargar_fuente(candidatas, cuerpo):
    for nombre in candidatas:
        try:
            return ImageFont.truetype(nombre, cuerpo)
        except OSError:
            continue
    return ImageFont.load_default(cuerpo)


def mascara_redondeada(ancho, alto, radio):
    """Rectángulo de esquinas redondeadas con el borde suavizado (imagen en modo L)."""
    grande = Image.new("L", (ancho * FINO, alto * FINO), 0)
    ImageDraw.Draw(grande).rounded_rectangle((0, 0, ancho * FINO - 1, alto * FINO - 1), radius=radio * FINO, fill=255)
    return grande.resize((ancho, alto), Image.LANCZOS)


class Pintor:
    """Dibuja la franja inferior del vídeo (subtítulos + recuadro) para un estado dado."""

    def __init__(self, ancho, alto, ancho_recuadro, banco, segmentos, con_subtitulos):
        self.ancho, self.alto = ancho, alto
        self.banco = banco
        self.segmentos = segmentos

        # El reproductor mete el vídeo en una escena 16:9 y lo mide todo respecto al ancho de la escena.
        # Aquí se mide respecto al fotograma real: `base` hace de ancho de escena. En un vídeo apaisado es
        # su ancho (o el de la escena 16:9 que cabe dentro, si es más panorámico); en uno vertical se amplía
        # hasta 1,6 veces el ancho para que el recuadro no quede diminuto.
        vertical = min(max(alto / ancho, 1), 1.6)
        base = min(ancho * vertical, alto * 16 / 9)
        cqw = base / 100
        self.vertical = alto > ancho

        # Recuadro (.recuadro, .tarjeta, .rotulo)
        self.borde = max(2, round(0.35 * cqw))
        self.radio = 1.4 * cqw
        ancho_total = min(round(base * ancho_recuadro / 100), ancho - 2 * round(0.022 * ancho))
        self.ancho_tarjeta = ancho_total - 2 * self.borde
        self.alto_tarjeta = round(self.ancho_tarjeta * 560 / 600)
        self.cuerpo_rotulo = max(6, round(1.7 * cqw))
        self.fuente_rotulo = cargar_fuente(FUENTES_ROTULO, self.cuerpo_rotulo)
        self.alto_rotulo = round((1.2 + 2 * 0.45) * self.cuerpo_rotulo)
        alto_total = self.alto_tarjeta + self.alto_rotulo + 2 * self.borde
        self.fuente_espera = cargar_fuente(FUENTES_TEXTO, max(6, round(4 * cqw)))
        self.x_recuadro = ancho - round(0.022 * ancho) - ancho_total
        self.y_recuadro = alto - round(0.035 * alto) - alto_total
        self.tam_recuadro = (ancho_total, alto_total)
        self.sombra = (round(0.6 * cqw), 1.1 * cqw)      # desplazamiento y desenfoque de la sombra
        self.margen = self.sombra[0] + round(3 * self.sombra[1]) + 1

        # Subtítulos (.subtitulos)
        self.cuerpo_sub = max(6, round(2.3 * cqw))
        self.fuente_sub = cargar_fuente(FUENTES_TEXTO, self.cuerpo_sub)
        self.interlinea = round(1.35 * self.cuerpo_sub)
        self.relleno_sub = (round(0.45 * self.cuerpo_sub), round(0.12 * self.cuerpo_sub))
        self.x_sub = round(0.03 * ancho)
        if self.vertical:                                # en vertical no caben al lado: van encima del recuadro
            self.ancho_sub = ancho - 2 * self.x_sub
            self.base_sub = self.y_recuadro - round(1.2 * cqw)
        else:
            self.ancho_sub = ancho - ancho_total - round(0.05 * ancho) - self.x_sub
            self.base_sub = alto - round(0.04 * alto)
        self.ancho_sub = max(self.ancho_sub, 4 * self.cuerpo_sub)
        self.renglones = {}                              # subtítulo -> renglones ya repartidos
        self.caja_sub = (None, None)                     # fondo del último subtítulo dibujado

        # Solo se dibuja (y solo tiene que mezclar ffmpeg) la franja de abajo, donde hay algo.
        arriba = self.y_recuadro - self.margen
        if con_subtitulos:
            mas_renglones = max((len(self.repartir(n)) for n in range(len(segmentos))), default=0)
            arriba = min(arriba, self.base_sub - mas_renglones * self.interlinea - self.cuerpo_sub)
        self.y_franja = max(0, arriba) // 2 * 2
        self.alto_franja = alto - self.y_franja

        self.tarjetas = {}                               # imágenes del banco ya escaladas
        self.preparar_recuadro()

    # ----- Recuadro -----

    def preparar_recuadro(self):
        """Deja hechas las dos partes fijas: el marco con su sombra y el recuadro en reposo."""
        (w, h), m, b = self.tam_recuadro, self.margen, self.borde
        capa = Image.new("RGBA", (w + 2 * m, h + 2 * m), (0, 0, 0, 0))
        exterior = mascara_redondeada(w, h, self.radio)
        silueta = Image.new("L", capa.size, 0)
        silueta.paste(exterior, (m, m + self.sombra[0]))
        silueta = silueta.filter(ImageFilter.GaussianBlur(self.sombra[1])).point(lambda v: round(v * 0.55))
        capa.putalpha(silueta)
        capa.paste(PAPEL + (255,), (m, m), exterior)

        # El interior (tarjeta + rótulo) se recorta con las esquinas redondeadas del marco.
        self.interior = mascara_redondeada(w - 2 * b, h - 2 * b, max(self.radio - b, 0))
        contenido = Image.new("RGBA", self.interior.size, PAPEL + (255,))
        ImageDraw.Draw(contenido).rectangle((0, self.alto_tarjeta, w, h), fill=TINTA + (255,))
        capa.paste(contenido, (m + b, m + b), self.interior)
        self.marco = capa

        reposo = capa.copy()
        centro = (m + b + self.ancho_tarjeta / 2, m + b + self.alto_tarjeta / 2)
        ImageDraw.Draw(reposo).text(centro, "· · ·", font=self.fuente_espera, fill=GRIS_ESPERA + (255,), anchor="mm")
        reposo.putalpha(reposo.getchannel("A").point(lambda v: round(v * OPACIDAD_REPOSO)))
        self.reposo = reposo

    def tarjeta(self, archivo):
        """Imagen del banco ajustada al hueco de la tarjeta (como object-fit: contain sobre blanco)."""
        if archivo not in self.tarjetas:
            if len(self.tarjetas) >= 80:                 # no acumular memoria en vídeos largos
                self.tarjetas.clear()
            hueco = (self.ancho_tarjeta, self.alto_tarjeta)
            lienzo = Image.new("RGBA", hueco, PAPEL + (255,))
            try:
                with Image.open(os.path.join(RAIZ, "banco", *archivo.split("/"))) as original:
                    dibujo = ImageOps.contain(original.convert("RGBA"), hueco, Image.LANCZOS)
                lienzo.alpha_composite(dibujo, ((hueco[0] - dibujo.width) // 2, (hueco[1] - dibujo.height) // 2))
            except (OSError, AttributeError):
                pass                                     # falta la imagen en el banco: tarjeta en blanco
            self.tarjetas[archivo] = lienzo
        return self.tarjetas[archivo]

    def pintar_recuadro(self, item):
        if item is None:
            return self.reposo
        capa = self.marco.copy()
        m, b = self.margen, self.borde
        capa.paste(self.tarjeta(item["imagen"]), (m + b, m + b), self.interior.crop((0, 0, self.ancho_tarjeta, self.alto_tarjeta)))

        # Rótulo: la palabra del signo o las letras del deletreo con la actual resaltada.
        if item["tipo"] == "signo":
            letras = [(c, PAPEL) for c in item["texto"].upper()]
        else:
            tenue = tuple(round(v * OPACIDAD_LETRA) + round(t * (1 - OPACIDAD_LETRA)) for v, t in zip(PAPEL, TINTA))
            letras = [(letra.upper(), ACENTO if k == item["posicion"] else tenue) for k, letra in enumerate(item["letras"])]
        fuente, cuerpo = self.fuente_rotulo, self.cuerpo_rotulo
        espacio = 0.06 * cuerpo                          # letter-spacing
        hueco = self.ancho_tarjeta - 2 * 0.3 * cuerpo
        anchos = [fuente.getlength(c) + espacio for c, _ in letras]
        if sum(anchos) > hueco:                          # no cabe: se corta con puntos suspensivos, como en la web
            puntos = fuente.getlength("…") + espacio
            while letras and sum(anchos) + puntos > hueco:
                letras.pop()
                anchos.pop()
            letras.append(("…", letras[-1][1] if letras else PAPEL))
            anchos.append(puntos)
        sube, baja = fuente.getmetrics()
        x = m + b + (self.ancho_tarjeta - sum(anchos)) / 2
        y = m + b + self.alto_tarjeta + 0.45 * cuerpo + (1.2 * cuerpo - (sube + baja)) / 2 + sube
        lapiz = ImageDraw.Draw(capa)
        for (c, color), avance in zip(letras, anchos):
            lapiz.text((x, y), c, font=fuente, fill=color + (255,), anchor="ls")
            x += avance
        return capa

    # ----- Subtítulos -----

    def repartir(self, n):
        """Reparte las palabras del subtítulo n en renglones que quepan: [[(índice, texto), ...], ...]."""
        if n not in self.renglones:
            hueco = self.ancho_sub - 2 * self.relleno_sub[0]
            renglones, actual = [], []
            for k, p in enumerate(self.segmentos[n]["palabras"]):
                prueba = " ".join(t for _, t in actual + [(k, p["texto"])])
                if actual and self.fuente_sub.getlength(prueba) > hueco:
                    renglones.append(actual)
                    actual = []
                actual.append((k, p["texto"]))
            if actual:
                renglones.append(actual)
            self.renglones[n] = renglones
        return self.renglones[n]

    def pintar_subtitulo(self, lienzo, n, resaltadas):
        renglones = self.repartir(n)
        if not renglones:
            return
        fuente, cuerpo = self.fuente_sub, self.cuerpo_sub
        sube, baja = fuente.getmetrics()
        rx, ry = self.relleno_sub
        arriba = self.base_sub - len(renglones) * self.interlinea - self.y_franja
        colocados = []                                   # (x del texto, y de la línea base, palabras)
        for i, renglon in enumerate(renglones):
            largo = fuente.getlength(" ".join(t for _, t in renglon))
            x = self.x_sub + (self.ancho_sub - largo) / 2
            y = arriba + i * self.interlinea + (self.interlinea - (sube + baja)) / 2 + sube
            colocados.append((x, y, largo, renglon))

        # Fondo: una caja por renglón (se juntan en una sola máscara para que no se oscurezcan al solaparse).
        if self.caja_sub[0] != n:
            x0 = int(min(x for x, *_ in colocados)) - rx - 1
            y0 = int(colocados[0][1]) - sube - ry - 1
            x1 = int(max(x + largo for x, _, largo, _ in colocados)) + rx + 2
            y1 = int(colocados[-1][1]) + baja + ry + 2
            grande = Image.new("L", ((x1 - x0) * FINO, (y1 - y0) * FINO), 0)
            lapiz = ImageDraw.Draw(grande)
            for x, y, largo, _ in colocados:
                lapiz.rounded_rectangle(((x - rx - x0) * FINO, (y - sube - ry - y0) * FINO,
                                         (x + largo + rx - x0) * FINO, (y + baja + ry - y0) * FINO),
                                        radius=0.25 * cuerpo * FINO, fill=FONDO_SUBTITULO)
            self.caja_sub = (n, (x0, y0, grande.resize((x1 - x0, y1 - y0), Image.LANCZOS)))
        x0, y0, mascara = self.caja_sub[1]
        lienzo.paste((0, 0, 0, 255), (x0, y0), mascara)

        lapiz = ImageDraw.Draw(lienzo)
        for x, y, _, renglon in colocados:
            previo = ""
            for k, texto in renglon:
                color = ACENTO if k in resaltadas else PAPEL
                lapiz.text((x + fuente.getlength(previo), y), texto, font=fuente, fill=color + (255,), anchor="ls")
                previo += texto + " "

    # ----- Estado completo -----

    def pintar(self, item, subtitulo, resaltadas):
        """Franja transparente con lo que se ve en un estado: subtítulos debajo y recuadro encima."""
        lienzo = Image.new("RGBA", (self.ancho, self.alto_franja), (0, 0, 0, 0))
        if subtitulo >= 0:
            self.pintar_subtitulo(lienzo, subtitulo, resaltadas)
        capa = self.pintar_recuadro(item)
        x, y = self.x_recuadro - self.margen, self.y_recuadro - self.margen - self.y_franja
        recorte = (max(0, -x), max(0, -y), min(capa.width, self.ancho - x), min(capa.height, self.alto_franja - y))
        lienzo.alpha_composite(capa.crop(recorte), (x + recorte[0], y + recorte[1]))
        return lienzo


# ---------- Vídeo ----------

def avisar(porcentaje, texto):
    """Línea de avance con el formato que entiende servidor.py («  12.5%  texto»)."""
    print(f"  {porcentaje:5.1f}%  {texto}", flush=True)


def examinar(video):
    """Tamaño con el que se ve el vídeo, duración y códec de audio (con ffprobe)."""
    orden = ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", video]
    try:
        info = json.loads(subprocess.run(orden, capture_output=True, check=True).stdout.decode("utf-8", "replace"))
    except FileNotFoundError:
        sys.exit("No encuentro ffprobe/ffmpeg. Hacen falta para exportar el vídeo.")
    except (subprocess.CalledProcessError, ValueError):
        sys.exit(f"ffprobe no ha podido leer el vídeo: {video}")
    imagen = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if imagen is None:
        sys.exit("El archivo no tiene imagen de vídeo.")
    sonido = next((s for s in info["streams"] if s.get("codec_type") == "audio"), None)

    ancho, alto = int(imagen["width"]), int(imagen["height"])
    proporcion = re.fullmatch(r"(\d+):(\d+)", imagen.get("sample_aspect_ratio") or "")
    if proporcion and int(proporcion.group(1)) > 0 and int(proporcion.group(2)) > 0:     # píxeles no cuadrados
        ancho = round(ancho * int(proporcion.group(1)) / int(proporcion.group(2)))
    giro = next((d.get("rotation") for d in imagen.get("side_data_list", []) if "rotation" in d), 0)
    if round(abs(float(giro or 0))) % 180 == 90:         # grabado de lado: ffmpeg lo endereza al leerlo
        ancho, alto = alto, ancho
    ancho, alto = ancho // 2 * 2, alto // 2 * 2          # libx264 necesita medidas pares

    duraciones = [float(d) for d in (info.get("format", {}).get("duration"), imagen.get("duration")) if d not in (None, "N/A")]
    return {"ancho": ancho, "alto": alto, "duracion": max(duraciones, default=0),
            "audio": sonido.get("codec_name") if sonido else None}


def exportar(video, ancho_recuadro=26, deletrear=True, subtitulos=True, salida=None):
    """Escribe el mp4 con el recuadro y los subtítulos pegados y devuelve su ruta."""
    base = os.path.splitext(video)[0]
    if not os.path.isfile(video):
        sys.exit(f"No encuentro el vídeo: {video}")
    if not os.path.isfile(base + ".signos.json"):
        sys.exit(f"El vídeo aún no está procesado. Ejecuta antes:  py procesar.py {video}")
    with open(base + ".signos.json", encoding="utf-8") as f:
        datos = json.load(f)
    with open(os.path.join(RAIZ, "banco", "indice.json"), encoding="utf-8") as f:
        banco = json.load(f)
    if salida is None:
        salida = os.path.join(RAIZ, "exportados", os.path.basename(base) + "-signos.mp4")
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)

    avisar(0, "Preparando las tarjetas...")
    info = examinar(video)
    duracion = max(info["duracion"], float(datos.get("duracion") or 0))
    linea = construir_linea(datos["unidades"], banco, deletrear)
    tramos = calcular_tramos(linea, datos["segmentos"], subtitulos, duracion)
    pintor = Pintor(info["ancho"], info["alto"], ancho_recuadro, banco, datos["segmentos"], subtitulos)

    # Las imágenes van a la carpeta temporal del sistema (no a la del proyecto, que se sincroniza con OneDrive).
    temporal = tempfile.mkdtemp(prefix="signos-exportar-")
    try:
        # 1) Una imagen por estado distinto y la lista con lo que dura cada una.
        archivos = {}
        lista = ["ffconcat version 1.0"]
        for i, (t0, t1, tarjeta, subtitulo, resaltadas) in enumerate(tramos):
            item = linea[tarjeta] if tarjeta >= 0 else None
            clave = (None if item is None else (item["imagen"], item.get("texto"), item.get("posicion"),
                                                "".join(item.get("letras", ()))), subtitulo, resaltadas)
            if clave not in archivos:
                archivos[clave] = f"e{len(archivos):05d}.png"
                pintor.pintar(item, subtitulo, resaltadas).save(os.path.join(temporal, archivos[clave]), compress_level=1)
            # «framerate 1000» da a ffmpeg precisión de milisegundos (si no, redondea a 1/25 s).
            lista += [f"file '{archivos[clave]}'", "option framerate 1000", f"duration {(t1 - t0) / 1000:.3f}"]
            if i % 20 == 0:
                avisar(10 * i / len(tramos), "Dibujando las tarjetas...")
        if not tramos:                                   # vídeo sin nada que mostrar: recuadro en reposo
            archivos[None] = "e00000.png"
            pintor.pintar(None, -1, ()).save(os.path.join(temporal, archivos[None]), compress_level=1)
            lista += [f"file '{archivos[None]}'", "option framerate 1000", "duration 1.000"]
        lista += [lista[-3], lista[-2]]                  # la última se repite para que ffmpeg respete su duración
        with open(os.path.join(temporal, "lista.ffconcat"), "w", encoding="utf-8") as f:
            f.write("\n".join(lista) + "\n")

        # 2) ffmpeg superpone la franja al vídeo y vuelve a codificar la imagen.
        avisar(10, "Codificando el vídeo...")
        # El «scale» no hace nada en un vídeo normal; iguala los de píxeles no cuadrados o medidas impares.
        filtros = (f"[0:v]scale={info['ancho']}:{info['alto']},setsar=1[v];"
                   f"[v][1:v]overlay=0:{pintor.y_franja}:eof_action=repeat[s]")
        provisional = os.path.join(temporal, "salida.mp4")
        orden = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", os.path.abspath(video),
                 "-f", "concat", "-safe", "0", "-i", "lista.ffconcat",
                 "-filter_complex", filtros, "-map", "[s]", "-map", "0:a:0?",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                 # El audio se copia tal cual si ya vale para mp4; si no, se pasa a AAC.
                 "-c:a", *(["copy"] if info["audio"] in ("aac", "mp3") else ["aac", "-b:a", "160k"]),
                 "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", provisional]
        prioridad = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)    # que el equipo siga respondiendo
        with open(os.path.join(temporal, "errores.txt"), "w+", encoding="utf-8", errors="replace") as errores:
            try:
                proceso = subprocess.Popen(orden, cwd=temporal, stdout=subprocess.PIPE, stderr=errores,
                                           text=True, encoding="utf-8", errors="replace", creationflags=prioridad)
            except FileNotFoundError:
                sys.exit("No encuentro ffmpeg. Hace falta para exportar el vídeo.")
            ultimo = time.time()
            for renglon in proceso.stdout:
                hecho = re.match(r"out_time_us=(\d+)", renglon)
                if hecho and duracion > 0 and time.time() - ultimo >= 0.5:
                    ultimo = time.time()
                    avisar(10 + 89 * min(int(hecho.group(1)) / 1e6 / duracion, 1), "Codificando el vídeo...")
            if proceso.wait() != 0:
                errores.seek(0)
                sys.exit("ffmpeg no ha podido generar el vídeo:\n" + errores.read()[-1500:])

        # 3) El resultado solo pasa a su sitio cuando está entero.
        for intento in range(5):
            try:
                shutil.move(provisional, salida)
                break
            except PermissionError:                      # el anterior se está descargando o sincronizando
                if intento == 4:
                    sys.exit(f"No puedo sustituir {salida}: está abierto en otro programa.")
                time.sleep(1)
    finally:
        shutil.rmtree(temporal, ignore_errors=True)
    avisar(100, "Vídeo terminado.")
    return salida


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--ancho", type=float, default=26, help="ancho del recuadro, en %% del ancho del vídeo (16-40; por defecto 26)")
    ap.add_argument("--sin-deletreo", action="store_true", help="no deletrear las palabras sin signo")
    ap.add_argument("--sin-subtitulos", action="store_true", help="no pegar los subtítulos")
    ap.add_argument("--salida", help="archivo mp4 de salida (por defecto exportados\\<nombre>-signos.mp4)")
    args = ap.parse_args()

    inicio = time.time()
    salida = exportar(args.video, ancho_recuadro=min(max(args.ancho, 16), 40), deletrear=not args.sin_deletreo,
                      subtitulos=not args.sin_subtitulos, salida=args.salida)
    print(f"\nListo en {time.time() - inicio:.0f} s  ->  {salida}")


if __name__ == "__main__":
    main()
