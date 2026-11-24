"""Convierte el «componente no manual» (CNM) de la lista de 500 signos en gestos del avatar (bloque nm).

El CNM viene en lenguaje natural («Sonrisa abierta, elevación ligera de cejas y contacto visual»). Aquí se
traduce con reglas sencillas a las claves de nm (ver herramientas/NOTACION.md). Solo se generan gestos
cuando el texto describe algo concreto; «expresión neutra» no produce nada.

Genera banco/propios/gestos.json con los gestos de las palabras de la lista que tienen movimiento extraído.

    py herramientas\\cnm_a_nm.py
"""
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "herramientas"))
from lista500 import cargar_recursos, clasificar  # noqa: E402
from texto import normalizar  # noqa: E402

SALIDA = os.path.join(RAIZ, "banco", "propios", "gestos.json")


def tiene(t, *claves):
    return any(c in t for c in claves)


def traducir(cnm):
    """Devuelve (estatico, movimiento) o None. estatico = dict de nm; movimiento = 'asiente' | 'niega' | None."""
    t = normalizar(cnm).lower()
    est, mov = {}, None
    ojos_normal = True
    if tiene(t, "sorpresa", "asombro"):
        est["expr"] = "sorpresa"
    elif tiene(t, "miedo", "susto", "alarma"):
        est["expr"] = "miedo"
    elif tiene(t, "asco", "desagrado", "rechazo"):
        est["expr"] = "asco"
    elif tiene(t, "enfado", "enojo", "irritacion", "molestia", "indignacion", "disgusto"):
        est["expr"] = "enfado"
    elif tiene(t, "tristeza", "pena", "lamento", "pesar", "apuro", "compasion"):
        est["expr"] = "tristeza"
    elif tiene(t, "dolor", "malestar", "sufrimiento", "mueca"):
        est["expr"] = "dolor"
    elif tiene(t, "cansancio", "agotamiento", "fatiga"):
        est["expr"] = "cansancio"
    elif tiene(t, "concentracion", "esfuerzo", "seriedad", "atencion"):
        est["expr"] = "concentracion"
    elif tiene(t, "duda", "incertidumbre", "vacilacion"):
        est["expr"] = "duda"
    elif tiene(t, "negacion", "negativ"):
        est["expr"] = "negacion"
    elif tiene(t, "interrogativ", "pregunta", "interrogacion"):
        est["expr"] = "pregunta"
    elif tiene(t, "alegria", "felicidad", "entusiasmo", "satisfaccion", "orgullo", "agrado", "carino", "afecto"):
        est["expr"] = "alegria"
    elif tiene(t, "sonrisa", "afable", "cordial", "amable", "amistos", "cercania", "calidez"):
        est["expr"] = "alegria"
        est["sonrisa"] = 0.9 if tiene(t, "sonrisa abierta", "sonrisa amplia", "gran sonrisa") else 0.55
    if tiene(t, "cejas altas", "cejas en alto", "cejas arriba", "cejas elevadas", "cejas arqueadas", "cejas levantadas", "elevacion de cejas", "elevacion ligera de cejas", "arqueo de cejas"):
        est["cejas"] = 0.7 if "ligera" not in t else 0.35
    if tiene(t, "cejas fruncidas", "ceño fruncido", "fruncimiento", "cejas juntas", "ceno fruncido", "entrecejo"):
        est["ceño"] = 0.5
    if tiene(t, "ojos cerrados", "cierre de ojos", "cierra los ojos"):
        est["ojos"] = 0
        ojos_normal = False
    elif tiene(t, "ojos entornados", "entornar", "parpadeo lento", "guino"):
        est["ojos"] = 0.4
        ojos_normal = False
    elif tiene(t, "ojos muy abiertos", "ojos abiertos", "mirada abierta"):
        est["ojos"] = 1.25
        ojos_normal = False
    if tiene(t, "mirada hacia abajo", "mirada baja", "mirada descendente", "baja la mirada"):
        est["mirada"] = [0, -0.8]
    elif tiene(t, "mirada hacia arriba", "mirada elevada", "mirada ascendente", "alza la mirada"):
        est["mirada"] = [0, 0.8]
    elif tiene(t, "mirada hacia el lado", "mirada lateral", "mirada desviada", "mirada a un lado"):
        est["mirada"] = [0.8, 0]
    if tiene(t, "mejillas infladas", "inflar las mejillas", "carrillos"):
        est["mejillas"] = 0.9
    if tiene(t, "inclinacion lateral de cabeza", "inclinacion de cabeza", "ladea", "cabeza ladeada", "inclinacion lateral"):
        est["cabeza_lado"] = 10
    if tiene(t, "inclinacion del tronco", "inclina el tronco", "reverencia", "inclinacion hacia delante", "tronco inclinado"):
        est["cuerpo_adelante"] = 10
    if tiene(t, "asentimiento", "asiente", "cabeceo afirmativo", "cabeza afirmativa", "afirmacion"):
        mov = "asiente"
    if tiene(t, "negacion con la cabeza", "sacudida", "cabeza de lado a lado", "cabeza negativa", "niega"):
        mov = "niega"
        est.setdefault("expr", "negacion")
    if tiene(t, "echa la cabeza atras", "cabeza atras", "cabeza hacia atras"):
        est["cabeza_adelante"] = -10
    if not est and not mov:
        return None
    return est, mov


def a_nm(est, mov):
    """Crea el bloque nm (necesita, nota y claves)."""
    c0 = {"t": 0}
    if "expr" in est:
        c0["expr"] = est["expr"]
    for k in ("sonrisa", "cejas", "ceño", "ojos", "mirada", "mejillas"):
        if k in est:
            c0[k] = est[k]
    cabeza = {}
    if "cabeza_lado" in est:
        cabeza["lado"] = est["cabeza_lado"]
    if "cabeza_adelante" in est:
        cabeza["adelante"] = est["cabeza_adelante"]
    if cabeza:
        c0["cabeza"] = cabeza
    if "cuerpo_adelante" in est:
        c0["cuerpo"] = {"adelante": est["cuerpo_adelante"]}
    claves = [c0]
    if mov == "asiente":
        c0.setdefault("cabeza", {})["adelante"] = 0
        claves += [{"t": 0.5, "cabeza": {"adelante": 9}}, {"t": 1, "cabeza": {"adelante": 0}}]
    elif mov == "niega":
        c0.setdefault("cabeza", {})["gira"] = -10
        claves += [{"t": 0.5, "cabeza": {"gira": 10}}, {"t": 1, "cabeza": {"gira": -10}}]
    usa_cuerpo = bool(cabeza or "cuerpo_adelante" in est or mov)
    usa_cara = any(k in est for k in ("expr", "sonrisa", "cejas", "ceño", "mejillas"))
    usa_ojos = "ojos" in est or "mirada" in est
    return {"necesita": {"cuerpo": usa_cuerpo, "cara": usa_cara, "ojos": usa_ojos}, "claves": claves}


def main():
    entradas = json.load(open(os.path.join(RAIZ, "banco", "lista500.json"), encoding="utf-8"))
    arasaac, extraidos, propios = cargar_recursos()
    gestos, con, sin = {}, 0, 0
    for e in entradas:
        estado, variante = clasificar(e, arasaac, extraidos, propios)
        if estado != "movimiento":
            continue
        r = traducir(e["cnm"])
        if not r:
            sin += 1
            continue
        nm = a_nm(*r)
        nm["nota"] = e["cnm"]
        nm["fuente"] = f"Lista de 500 signos (Gemini), n.º {e['n']}: componente no manual"
        gestos[variante.lower()] = nm
        con += 1
    with open(SALIDA, "w", encoding="utf-8") as f:
        json.dump({"nota": "Gestos no manuales de las palabras de la lista de 500 que tienen movimiento extraído. "
                           "Proceden del texto de la lista (IA, sin verificar).", "gestos": gestos}, f, ensure_ascii=False, indent=1)
    print(f"{con} palabras con gestos, {sin} con expresión neutra -> {SALIDA}")
    cuenta = {"cuerpo": 0, "cara": 0, "ojos": 0}
    for g in gestos.values():
        for k in cuenta:
            cuenta[k] += g["necesita"][k]
    print("necesitan:", cuenta)


if __name__ == "__main__":
    main()
