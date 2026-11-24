"""Publica la app en el servidor de despliegue: el APK, la página de descarga y el archivo de versión.

    py herramientas/desplegar.py             (publica android/signatodo.apk)
    py herramientas/desplegar.py --simular   (prepara despliegue/salida y no sube nada)
    py herramientas/desplegar.py --sin-apk   (solo la página; el APK del servidor no se toca)

Antes hay que compilar el APK (py android/construir.py) habiendo subido VERSION_CODIGO: la app instalada solo se actualiza si
el número de versión publicado es mayor que el suyo. Las novedades de cada versión van en despliegue/novedades.json.

Los datos del servidor (dirección, usuario, clave SSH y carpeta) NO están en el repositorio: se leen de
despliegue/servidor.local.json (copia despliegue/servidor.ejemplo.json y rellénalo). Hace falta el cliente OpenSSH (ssh y scp).

Qué queda en el servidor:
  signatodo-<versión>.apk   el instalable (se conservan el actual y el anterior)
  version.json              lo que consulta la app para saber si hay versión nueva (se sube lo último, con el APK ya arriba)
  index.html y demás        la página de descarga (despliegue/sitio)
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITIO = os.path.join(RAIZ, "despliegue", "sitio")
SALIDA = os.path.join(RAIZ, "despliegue", "salida")
APK = os.path.join(RAIZ, "android", "signatodo.apk")
MESES = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()


def cargar_construir():
    spec = importlib.util.spec_from_file_location("construir", os.path.join(RAIZ, "android", "construir.py"))
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def version_del_apk(apk):
    """Versión que lleva dentro el APK (no la del script: la que de verdad se va a publicar)."""
    c = cargar_construir()
    aapt2 = os.path.join(c.ultimo(os.path.join(c.buscar_sdk(), "build-tools")), "aapt2.exe")
    texto = subprocess.run([aapt2, "dump", "badging", apk], capture_output=True, text=True, check=True).stdout
    m = re.search(r"versionCode='(\d+)' versionName='([^']+)'", texto)
    if not m:
        sys.exit("No encuentro la versión dentro del APK.")
    return int(m.group(1)), m.group(2)


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def preparar(con_apk):
    codigo, nombre = version_del_apk(APK)
    novedades = json.load(open(os.path.join(RAIZ, "despliegue", "novedades.json"), encoding="utf-8"))
    notas = novedades.get(nombre)
    if not notas:
        sys.exit(f"Faltan las novedades de la versión {nombre} en despliegue/novedades.json.")
    fecha = datetime.date.fromtimestamp(os.path.getmtime(APK))
    tamano = os.path.getsize(APK)
    archivo = f"signatodo-{nombre}.apk"
    version = {"versionCode": codigo, "versionName": nombre, "apk": archivo, "bytes": tamano, "sha256": sha256(APK),
               "fecha": fecha.isoformat(), "notas": notas}

    if os.path.isdir(SALIDA):
        shutil.rmtree(SALIDA)
    shutil.copytree(SITIO, SALIDA)
    escapar = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    pagina = open(os.path.join(SITIO, "index.html"), encoding="utf-8").read()
    for clave, valor in {
        "{{VERSION}}": nombre, "{{CODIGO}}": str(codigo), "{{APK}}": archivo,
        "{{FECHA}}": f"{fecha.day} de {MESES[fecha.month - 1]} de {fecha.year}",
        "{{TAMANO}}": f"{tamano / 1e6:.1f} MB".replace(".", ","),
        "{{NOTAS}}": "\n".join(f"          <li>{escapar(n)}</li>" for n in notas),
    }.items():
        pagina = pagina.replace(clave, valor)
    if "{{" in pagina:
        sys.exit("Quedan marcas sin rellenar en index.html.")
    open(os.path.join(SALIDA, "index.html"), "w", encoding="utf-8", newline="\n").write(pagina)
    with open(os.path.join(SALIDA, "version.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(version, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if con_apk:
        shutil.copyfile(APK, os.path.join(SALIDA, archivo))
    return version


class Servidor:
    def __init__(self):
        ruta = os.path.join(RAIZ, "despliegue", "servidor.local.json")
        if not os.path.isfile(ruta):
            sys.exit("Falta despliegue/servidor.local.json (copia servidor.ejemplo.json y rellénalo).")
        d = json.load(open(ruta, encoding="utf-8"))
        self.destino = f"{d['usuario']}@{d['host']}"
        self.carpeta = d["carpeta"].rstrip("/")
        self.url = d["url"].rstrip("/") + "/"
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", self.carpeta) or self.carpeta.count("/") < 3:
            sys.exit("La carpeta del servidor no parece una carpeta de despliegue.")
        self.opciones = ["-i", d["clave"], "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]

    def remoto(self, guion):
        """Ejecuta un guion de bash en el servidor (se sube a /tmp para no pelearse con las comillas)."""
        with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False, encoding="utf-8", newline="\n") as f:
            f.write("set -e\n" + guion + "\n")
        try:
            subprocess.run(["scp", "-q", *self.opciones, f.name, f"{self.destino}:/tmp/signatodo_despliegue.sh"], check=True)
            r = subprocess.run(["ssh", *self.opciones, self.destino, "bash /tmp/signatodo_despliegue.sh; e=$?; rm -f /tmp/signatodo_despliegue.sh; exit $e"],
                               capture_output=True, text=True)
        finally:
            os.unlink(f.name)
        if r.returncode:
            sys.exit(f"Falló en el servidor:\n{r.stdout}{r.stderr}")
        return r.stdout.strip()

    def subir(self, archivos, a):
        subprocess.run(["scp", "-q", *self.opciones, *archivos, f"{self.destino}:{a}"], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simular", action="store_true", help="prepara despliegue/salida y no sube nada")
    ap.add_argument("--sin-apk", action="store_true", help="publica solo la página")
    args = ap.parse_args()
    if not os.path.isfile(APK):
        sys.exit("No está android/signatodo.apk: compílalo antes con py android/construir.py")

    version = preparar(con_apk=not args.sin_apk)
    print(f"Versión {version['versionName']} (código {version['versionCode']}) · {version['bytes'] / 1e6:.1f} MB · sha256 {version['sha256'][:16]}…")
    if args.simular:
        print("Preparado en despliegue/salida. No se ha subido nada.")
        return

    s = Servidor()
    c = s.carpeta
    print("1. Carpeta en el servidor")
    # El contador escribe en data/: es del grupo del servidor web y nadie la ve desde fuera.
    s.remoto(f"mkdir -p {c}/data && chgrp www-data {c} {c}/data && chmod 2775 {c}/data && chmod 755 {c}\n"
             f"[ -f {c}/data/.htaccess ] || echo 'Require all denied' > {c}/data/.htaccess")

    apk = version["apk"]
    if not args.sin_apk:
        print("2. APK")
        ya = s.remoto(f"[ -f {c}/{apk} ] && sha256sum {c}/{apk} | cut -d' ' -f1 || true")
        if ya == version["sha256"]:
            print("   ya estaba arriba, idéntico")
        else:
            anterior = s.remoto(f"cat {c}/version.json 2>/dev/null || true")
            publicado = re.search(r'"versionCode"\s*:\s*(\d+)', anterior)
            if publicado and int(publicado.group(1)) > version["versionCode"]:
                sys.exit(f"El servidor ya tiene una versión más nueva (código {publicado.group(1)}). No se sube.")
            s.subir([os.path.join(SALIDA, apk)], f"{c}/.subiendo.apk")
            arriba = s.remoto(f"sha256sum {c}/.subiendo.apk | cut -d' ' -f1")
            if arriba != version["sha256"]:
                s.remoto(f"rm -f {c}/.subiendo.apk")
                sys.exit("El APK ha llegado distinto al servidor. No se publica.")
            s.remoto(f"chmod 644 {c}/.subiendo.apk && mv -f {c}/.subiendo.apk {c}/{apk}")

    print("3. Página")
    ocultos = [".htaccess"]
    resto = [n for n in os.listdir(SALIDA) if n not in ocultos and n not in ("index.html", "version.json") and not n.endswith(".apk")]
    s.subir([os.path.join(SALIDA, n) for n in ocultos + resto], c + "/")
    print("4. Portada y versión (lo último: la app no ve la versión nueva hasta que todo lo demás está arriba)")
    s.subir([os.path.join(SALIDA, "index.html")], c + "/")
    if not args.sin_apk:
        s.subir([os.path.join(SALIDA, "version.json")], f"{c}/.version.json")
        s.remoto(f"mv -f {c}/.version.json {c}/version.json")
    # Permisos, y fuera los APK viejos: se quedan el actual y el anterior.
    s.remoto(f"cd {c} && chmod 644 .htaccess *.html *.css *.js *.php *.json *.txt *.xml *.svg *.png *.webp 2>/dev/null; true\n"
             f"cd {c} && ls -t signatodo-*.apk 2>/dev/null | tail -n +3 | xargs -r rm -f")

    print("5. Comprobación por HTTPS")
    with urllib.request.urlopen(urllib.request.Request(s.url + "version.json", headers={"User-Agent": "Signatodo-despliegue"}), timeout=30) as r:
        publicada = json.load(r)
    pedido = urllib.request.Request(s.url + publicada["apk"], method="HEAD", headers={"User-Agent": "Signatodo-despliegue"})
    with urllib.request.urlopen(pedido, timeout=30) as r:
        tamano, tipo = int(r.headers.get("Content-Length", 0)), r.headers.get("Content-Type", "")
    bien = tamano == publicada["bytes"] and (args.sin_apk or publicada["sha256"] == version["sha256"])
    print(f"   {s.url} → versión {publicada['versionName']} (código {publicada['versionCode']}), APK de {tamano / 1e6:.1f} MB, {tipo}")
    if not bien:
        sys.exit("Lo publicado no coincide con lo que se ha subido.")
    print("Publicado.")


if __name__ == "__main__":
    main()
