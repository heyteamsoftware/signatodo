"""Servidor local del reproductor con recuadro de signos.

Uso:  py servidor.py      y abrir http://localhost:8765 en el navegador.
"""
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlparse

RAIZ = os.path.dirname(os.path.abspath(__file__))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
PUBLICAS = ("web", "banco", "videos", "exportados")   # únicas carpetas que se sirven
EXT_VIDEO = (".mp4", ".webm", ".m4v", ".mov")


def listar_videos():
    carpeta = os.path.join(RAIZ, "videos")
    videos = []
    for nombre in sorted(os.listdir(carpeta)) if os.path.isdir(carpeta) else []:
        base, ext = os.path.splitext(nombre)
        if ext.lower() in EXT_VIDEO:
            datos = base + ".signos.json"
            videos.append({"nombre": base, "video": f"/videos/{nombre}",
                           "datos": f"/videos/{datos}" if os.path.isfile(os.path.join(carpeta, datos)) else None})
    return videos


# Estado del trabajo en curso: procesar un vídeo o exportarlo con los signos pegados
# (solo uno a la vez, sea del tipo que sea: el equipo no da para más).
trabajo = {"estado": "libre", "tipo": None, "video": None, "progreso": 0, "linea": "", "error": "", "archivo": None}
cerrojo = threading.Lock()


def trabajar_en_segundo_plano(orden, archivo=None):
    """Lanza procesar.py o exportar.py y va apuntando su avance en `trabajo`."""
    entorno = dict(os.environ, PYTHONIOENCODING="utf-8")
    salida = []
    try:
        proceso = subprocess.Popen(orden, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=RAIZ,
                                   env=entorno, text=True, encoding="utf-8", errors="replace")
        for linea in proceso.stdout:
            linea = linea.rstrip()
            salida.append(linea)
            avance = re.match(r"\s*([\d.]+)%\s+(.*)", linea)
            with cerrojo:
                if avance:
                    trabajo["progreso"] = min(float(avance.group(1)), 100)
                    trabajo["linea"] = avance.group(2)
                elif linea.startswith("Cargando"):
                    trabajo["linea"] = linea
        codigo = proceso.wait()
    except OSError as e:
        codigo, salida = 1, [str(e)]
    with cerrojo:
        if codigo == 0:
            trabajo.update(estado="listo", progreso=100, archivo=archivo)
        else:
            trabajo.update(estado="error", error="\n".join([x for x in salida if x][-6:]))


def iniciar_trabajo(tipo, nombre, ajustes=None):
    """Arranca el procesado o la exportación de un vídeo. Devuelve (código HTTP, respuesta)."""
    valido = os.path.basename(nombre) == nombre and os.path.splitext(nombre)[1].lower() in EXT_VIDEO
    ruta = os.path.join(RAIZ, "videos", nombre)
    if not valido or not os.path.isfile(ruta):
        return 404, {"error": "No encuentro ese vídeo en la carpeta videos."}
    base = os.path.splitext(nombre)[0]
    archivo = None
    if tipo == "procesar":
        orden = [sys.executable, "-u", os.path.join(RAIZ, "procesar.py"), ruta]
        linea = "Extrayendo el audio..."
    else:
        if not os.path.isfile(os.path.join(RAIZ, "videos", base + ".signos.json")):
            return 400, {"error": "Ese vídeo aún no está procesado."}
        ajustes = ajustes or {}
        try:
            ancho = min(max(float(ajustes.get("ancho", 26)), 16), 60)
        except (TypeError, ValueError):
            return 400, {"error": "Petición incorrecta."}
        orden = [sys.executable, "-u", os.path.join(RAIZ, "exportar.py"), ruta, "--ancho", f"{ancho:g}"]
        orden += [] if ajustes.get("deletrear", True) else ["--sin-deletreo"]
        orden += [] if ajustes.get("subtitulos", True) else ["--sin-subtitulos"]
        archivo = "/exportados/" + quote(base + "-signos.mp4")
        linea = "Preparando las tarjetas..."
    with cerrojo:
        if trabajo["estado"] == "en_curso":
            haciendo = "procesando" if trabajo["tipo"] == "procesar" else "exportando"
            return 409, {"error": f"Ya se está {haciendo} «{trabajo['video']}». Espera a que termine."}
        trabajo.update(estado="en_curso", tipo=tipo, video=nombre, progreso=0, linea=linea, error="", archivo=None)
    threading.Thread(target=trabajar_en_segundo_plano, args=(orden, archivo), daemon=True).start()
    return 202, dict(trabajo)


def listar_propios():
    """Ficheros de signos propios: el base y los lotes (banco/propios/lotes/lote_*.json)."""
    urls = ["/banco/propios/signos.json"]
    lotes = os.path.join(RAIZ, "banco", "propios", "lotes")
    if os.path.isdir(lotes):
        urls += [f"/banco/propios/lotes/{n}" for n in sorted(os.listdir(lotes)) if n.startswith("lote_") and n.endswith(".json")]
    return urls


class Manejador(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self.servir(con_cuerpo=True)

    def do_HEAD(self):
        self.servir(con_cuerpo=False)

    def do_POST(self):
        ruta = urlparse(self.path).path
        largo = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(largo) if largo else b""
        # Solo JSON: así otra página web no puede lanzar un trabajo sin permiso del navegador.
        if ruta not in ("/api/procesar", "/api/exportar") or "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.responder(404, b"No encontrado")
        try:
            pedido = json.loads(cuerpo.decode("utf-8"))
            nombre = str(pedido["video"])
        except (ValueError, KeyError, TypeError):
            return self.responder_json(400, {"error": "Petición incorrecta."})
        self.responder_json(*iniciar_trabajo(ruta.rsplit("/", 1)[1], nombre, pedido))

    def responder_json(self, estado, datos, con_cuerpo=True):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.responder(estado, cuerpo, "application/json; charset=utf-8", con_cuerpo)

    def responder(self, estado, cuerpo, tipo="text/plain; charset=utf-8", con_cuerpo=True):
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if con_cuerpo:
            self.wfile.write(cuerpo)

    def servir(self, con_cuerpo):
        ruta = unquote(urlparse(self.path).path)
        if ruta == "/api/propios":
            return self.responder_json(200, listar_propios(), con_cuerpo)
        if ruta == "/api/videos":
            return self.responder_json(200, listar_videos(), con_cuerpo)
        if ruta == "/api/estado":
            with cerrojo:
                return self.responder_json(200, dict(trabajo), con_cuerpo)
        if ruta == "/":
            ruta = "/web/index.html"
        partes = [p for p in ruta.split("/") if p]
        archivo = os.path.join(RAIZ, *partes) if partes else ""
        if not partes or partes[0] not in PUBLICAS or ".." in partes or not os.path.isfile(archivo):
            return self.responder(404, b"No encontrado", con_cuerpo=con_cuerpo)

        total = os.path.getsize(archivo)
        inicio, fin, estado = 0, total - 1, 200
        rango = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
        if rango and (rango.group(1) or rango.group(2)):   # el vídeo se pide a trozos para poder saltar
            if rango.group(1):
                inicio = int(rango.group(1))
                fin = min(int(rango.group(2)), total - 1) if rango.group(2) else total - 1
            else:
                inicio = max(total - int(rango.group(2)), 0)
            if inicio > fin:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{total}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            estado = 206

        tipo = mimetypes.guess_type(archivo)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo in ("application/json", "application/javascript"):
            tipo += "; charset=utf-8"
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(fin - inicio + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "max-age=3600" if partes[0] == "banco" and archivo.endswith(".png") else "no-cache")
        if estado == 206:
            self.send_header("Content-Range", f"bytes {inicio}-{fin}/{total}")
        if partes[0] == "exportados":                      # los vídeos exportados se descargan, no se abren
            sencillo = partes[-1].encode("ascii", "replace").decode("ascii").replace('"', "'")
            self.send_header("Content-Disposition",
                             f"attachment; filename=\"{sencillo}\"; filename*=UTF-8''{quote(partes[-1], safe='')}")
        self.end_headers()
        if not con_cuerpo:
            return
        try:
            with open(archivo, "rb") as f:
                f.seek(inicio)
                quedan = fin - inicio + 1
                while quedan > 0:
                    trozo = f.read(min(65536, quedan))
                    if not trozo:
                        break
                    self.wfile.write(trozo)
                    quedan -= len(trozo)
        except (ConnectionError, OSError):
            pass                                           # el navegador cortó la descarga (normal al saltar en el vídeo)

    def log_message(self, formato, *args):
        pass


if __name__ == "__main__":
    mimetypes.add_type("application/javascript", ".js")
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    print(f"Reproductor de signos en http://localhost:{PUERTO}  (Ctrl+C para parar)", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
