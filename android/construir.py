"""Construye el APK de Signatodo en directo sin Gradle, solo con las herramientas del SDK de Android.

    py android/construir.py                  (APK completo, con todos los movimientos extraídos)
    py android/construir.py --poses ninguna  (APK ligero, sin movimientos: solo para probar la app)

Necesita Android Studio (de ahí sale el JDK) y el SDK de Android (build-tools y una plataforma). Salida: android/signatodo.apk,
firmado con una clave de pruebas (android/clave-pruebas.keystore), suficiente para instalarlo en tu teléfono.

El APK lleva dentro todo lo necesario para signar: no hay servidor ni se descarga nada (lo único que pide a internet es si
hay una versión nueva, ver herramientas/desplegar.py). Para publicarlo: py herramientas/desplegar.py. OJO: los movimientos vienen de los vídeos de
ARASAAC (CC BY-NC-SA, solo uso no comercial); no repartas el APK con ellos sin cumplir esa licencia.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AND = os.path.join(RAIZ, "android")
OBRA = os.path.join(AND, "build")
VERSION_CODIGO, VERSION_NOMBRE = 5, "0.5"       # 0.5: actualización automática desde el servidor y nombre de la app arriba


def buscar_sdk():
    for c in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
              os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")):
        if c and os.path.isdir(os.path.join(c, "build-tools")):
            return c
    sys.exit("No encuentro el SDK de Android (define ANDROID_HOME).")


def buscar_jdk():
    for c in (os.environ.get("JAVA_HOME"), r"C:\Program Files\Android\Android Studio\jbr"):
        if c and os.path.isfile(os.path.join(c, "bin", "javac.exe")):
            return c
    sys.exit("No encuentro el JDK (instala Android Studio o define JAVA_HOME).")


def ultimo(carpeta, patron="*"):
    cs = sorted(glob.glob(os.path.join(carpeta, patron)))
    if not cs:
        sys.exit(f"No hay nada en {carpeta}")
    return cs[-1]


def ejecutar(orden, **kw):
    print("  $", " ".join(f'"{o}"' if " " in o else o for o in orden)[:200])
    r = subprocess.run(orden, capture_output=True, text=True, **kw)
    if r.returncode:
        print(r.stdout[-2000:], r.stderr[-3000:])
        sys.exit(f"Falló: {orden[0]}")
    return r.stdout


def copiar_json(origen, carpeta):
    """Copia un JSON comprobando que está entero.

    La extracción de movimientos puede estar reescribiendo archivos mientras se construye el APK; uno a medio escribir
    dejaría esa palabra sin signo en la app. Si no se lee bien, se reintenta un momento después.
    """
    destino = os.path.join(carpeta, os.path.basename(origen))
    for _ in range(4):
        try:
            shutil.copy(origen, destino)
            with open(destino, encoding="utf-8") as f:
                json.load(f)
            return True
        except (OSError, ValueError):
            time.sleep(0.6)
    if os.path.isfile(destino):
        os.remove(destino)
    return False


def preparar_assets(poses):
    assets = os.path.join(OBRA, "assets")
    shutil.copytree(os.path.join(RAIZ, "web"), os.path.join(assets, "web"))
    shutil.copytree(os.path.join(RAIZ, "banco", "propios"), os.path.join(assets, "banco", "propios"),
                    ignore=shutil.ignore_patterns("revisiones"))
    shutil.copy(os.path.join(RAIZ, "banco", "lemas.json"), os.path.join(assets, "banco", "lemas.json"))
    destino = os.path.join(assets, "banco", "poses")
    os.makedirs(destino)
    if poses == "todas":
        n, malos = 0, []
        for f in glob.glob(os.path.join(RAIZ, "banco", "poses", "*.json")):
            if copiar_json(f, destino):
                n += 1
            else:
                malos.append(os.path.basename(f))
        print(f"  {n} archivos de movimiento")
        if malos:
            print(f"  AVISO: {len(malos)} archivos no se han podido leer y no van en el APK: {', '.join(malos[:8])}")
    else:
        with open(os.path.join(destino, "indice.json"), "w", encoding="utf-8") as f:
            f.write("{}")
    # Lista de archivos de signos propios, que en el ordenador da el servidor (/api/propios).
    lista = ["/banco/propios/signos.json"] + [f"/banco/propios/lotes/{os.path.basename(p)}" for p in
                                               sorted(glob.glob(os.path.join(RAIZ, "banco", "propios", "lotes", "lote_*.json")))]
    with open(os.path.join(assets, "api_propios.json"), "w", encoding="utf-8") as f:
        json.dump(lista, f)
    return assets


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--poses", choices=["todas", "ninguna"], default="todas")
    args = ap.parse_args()

    sdk, jdk = buscar_sdk(), buscar_jdk()
    bt = ultimo(os.path.join(sdk, "build-tools"))
    android_jar = os.path.join(ultimo(os.path.join(sdk, "platforms"), "android-*"), "android.jar")
    print("SDK:", sdk, "| build-tools:", os.path.basename(bt), "| JDK:", jdk)
    if os.path.isdir(OBRA):
        shutil.rmtree(OBRA)
    os.makedirs(OBRA)

    print("1. Contenido (assets)")
    assets = preparar_assets(args.poses)

    print("2. Recursos")
    ejecutar([os.path.join(bt, "aapt2.exe"), "compile", "--dir", os.path.join(AND, "res"), "-o", os.path.join(OBRA, "res.zip")])

    print("3. Paquete base")
    base = os.path.join(OBRA, "base.apk")
    ejecutar([os.path.join(bt, "aapt2.exe"), "link", "-o", base, "-I", android_jar, "--manifest", os.path.join(AND, "AndroidManifest.xml"),
              "-R", os.path.join(OBRA, "res.zip"), "-A", assets, "--min-sdk-version", "24", "--target-sdk-version", "34",
              "--version-code", str(VERSION_CODIGO), "--version-name", VERSION_NOMBRE])

    print("4. Java")
    clases = os.path.join(OBRA, "clases")
    os.makedirs(clases)
    fuentes = glob.glob(os.path.join(AND, "src", "**", "*.java"), recursive=True)
    ejecutar([os.path.join(jdk, "bin", "javac.exe"), "--release", "11", "-Xlint:-options", "-classpath", android_jar, "-d", clases] + fuentes)
    clases_class = glob.glob(os.path.join(clases, "**", "*.class"), recursive=True)
    dex = os.path.join(OBRA, "dex")
    os.makedirs(dex)
    env = dict(os.environ, JAVA_HOME=jdk)
    ejecutar([os.path.join(bt, "d8.bat"), "--lib", android_jar, "--min-api", "24", "--output", dex] + clases_class, env=env)
    with zipfile.ZipFile(base, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(dex, "classes.dex"), "classes.dex")

    print("5. Alinear y firmar")
    alineado = os.path.join(OBRA, "alineado.apk")
    ejecutar([os.path.join(bt, "zipalign.exe"), "-f", "-p", "4", base, alineado])
    clave = os.path.join(AND, "clave-pruebas.keystore")
    if not os.path.isfile(clave):
        ejecutar([os.path.join(jdk, "bin", "keytool.exe"), "-genkeypair", "-keystore", clave, "-alias", "signatodo", "-keyalg", "RSA",
                  "-keysize", "2048", "-validity", "10000", "-storepass", "android", "-keypass", "android", "-dname", "CN=Signatodo pruebas"])
    salida = os.path.join(AND, "signatodo.apk")
    ejecutar([os.path.join(bt, "apksigner.bat"), "sign", "--ks", clave, "--ks-pass", "pass:android", "--key-pass", "pass:android",
              "--out", salida, alineado], env=env)
    ejecutar([os.path.join(bt, "apksigner.bat"), "verify", salida], env=env)
    print(f"\nListo: {salida}  ({os.path.getsize(salida) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
