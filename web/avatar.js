// Avatar 2D de trazo de línea: reproduce los signos enlazándolos con fluidez.
//
// Cada signo es un clip de movimiento (banco/poses/<id>.json) extraído de un vídeo de
// referencia: 9 puntos del cuerpo y 21 por mano, con origen entre los hombros y el
// ancho de hombros como unidad, más la profundidad de cada punto de las manos. Aquí se
// encadenan los clips, se interpola entre el final de uno y el principio del siguiente,
// y se dibuja un personaje minimalista con cara (cejas, ojos, boca que vocaliza).

const Avatar = (() => {
  const TRANSICION = 0.28;      // segundos de enlace mínimo entre dos signos
  const A_REPOSO = 0.45;        // lo que tarda en bajar o subir las manos
  const PAUSA_LARGA = 1.3;      // con un hueco mayor, las manos vuelven a reposo entre signos
  const ANTICIPO = 0.15;        // el signo empieza un poco antes que la palabra
  const TINTA = '#111', PAPEL = '#fff';

  let lienzo, ctx;
  let indice = null;            // clave normalizada -> id de clip
  const clips = {};             // id -> clip ya convertido a poses
  let pista = [];               // signos colocados en el tiempo

  // ----- Poses -----
  // Una pose es una lista de 146 números:
  //   0-17    cuerpo (x, y): nariz, hombros i/d, codos i/d, muñecas i/d, caderas i/d
  //   18-59   mano izquierda, 21 puntos (x, y)        60-101  mano derecha
  //   102-122 profundidad de los 21 puntos de la izquierda   123-143  de la derecha
  //   144-145 profundidad de cada muñeca (menor = más cerca de quien mira)
  const IZQ = 18, DER = 60, Z_IZQ = 102, Z_DER = 123, Z_MUNECAS = 144;
  const CEROS = new Array(21).fill(0);

  // Mano relajada (colgando), relativa a la muñeca; lado = +1 izquierda de la persona, -1 derecha.
  function manoRelajada(mx, my, lado) {
    const p = [mx, my];
    [[0.08, 0.08], [0.13, 0.16], [0.16, 0.23], [0.17, 0.29]].forEach(([x, y]) => p.push(mx + lado * x, my + y));
    for (let dedo = 0; dedo < 4; dedo++) {
      const x = lado * (0.07 - dedo * 0.045), corto = dedo === 3 ? 0.04 : 0;
      [0.21, 0.30, 0.36, 0.41].forEach((y, k) => p.push(mx + x, my + y - (k ? corto : 0)));
    }
    return p;
  }

  function pose(cuerpo, izq, der, zi, zd, zm) {
    return cuerpo.concat(
      izq || manoRelajada(cuerpo[10], cuerpo[11], 1), der || manoRelajada(cuerpo[12], cuerpo[13], -1),
      (izq && zi) || CEROS, (der && zd) || CEROS, zm || [0, 0]);
  }

  // Reposo natural: brazos sueltos a los lados, codos apenas doblados y manos relajadas a la altura de la cadera.
  const CUERPO_REPOSO = [0, -0.72, 0.5, 0, -0.5, 0, 0.68, 0.92, -0.68, 0.92, 0.6, 1.72, -0.6, 1.72, 0.33, 1.7, -0.33, 1.7];
  const REPOSO = pose(CUERPO_REPOSO);

  const suave = (x) => x * x * (3 - 2 * x);
  const mezclar = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

  function convertir(clip) {
    const poses = [];
    for (let f = 0; f < clip.n; f++) {
      const escala = (lista) => lista && lista[f].map((v) => v / 1000);
      poses.push(pose(escala(clip.cuerpo), escala(clip.izq), escala(clip.der), escala(clip.zi), escala(clip.zd), escala(clip.zm)));
    }
    return { poses, dura: clip.n / clip.fps };
  }

  function poseDeClip(clip, k) {              // k = 0..1 a lo largo del clip
    const x = Math.min(Math.max(k, 0), 1) * (clip.poses.length - 1);
    const a = Math.floor(x), b = Math.min(a + 1, clip.poses.length - 1);
    return mezclar(clip.poses[a], clip.poses[b], x - a);
  }

  // ----- Preparación: qué clip corresponde a cada palabra y cuándo se signa -----

  function normalizar(texto) {
    return texto.toUpperCase().replace(/Ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\u0001/g, 'Ñ').replace(/[^A-ZÑ0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function iniciar(canvas) {
    lienzo = canvas;
    ctx = canvas.getContext('2d');
    try {
      const r = await fetch('/banco/poses/indice.json');
      indice = r.ok ? await r.json() : {};
    } catch { indice = {}; }
    return Object.keys(indice).length;
  }

  // unidades: las de <video>.signos.json; tarjetas: banco.tarjetas (para probar también con su etiqueta)
  async function preparar(unidades, tarjetas) {
    pista = [];
    const elegidas = [];
    for (const u of unidades) {
      if (u.tipo !== 'signo') continue;
      const etiqueta = tarjetas[u.tarjeta]?.etiqueta || '';
      const candidatas = [normalizar(u.texto), normalizar(etiqueta), normalizar(u.tarjeta.replace(/ny/g, 'ñ').replace(/-/g, ' '))];
      const clave = candidatas.find((c) => indice[c] !== undefined);
      if (clave) elegidas.push({ u, id: indice[clave] });
    }
    await Promise.all([...new Set(elegidas.map((e) => e.id))].filter((id) => !clips[id]).map(async (id) => {
      const r = await fetch(`/banco/poses/${id}.json`);
      if (r.ok) clips[id] = convertir(await r.json());
    }));
    let cursor = 0;
    const validas = elegidas.filter((e) => clips[e.id]);
    validas.forEach(({ u, id }, k) => {
      const clip = clips[id];
      const t0 = Math.max(u.t0 - ANTICIPO, cursor + TRANSICION);
      // Signa a su ritmo si cabe antes de la palabra siguiente; si no, acelera (hasta 1,8x).
      const siguiente = validas[k + 1];
      const hueco = siguiente ? siguiente.u.t0 - ANTICIPO - TRANSICION - t0 : Infinity;
      const velocidad = Math.min(Math.max(clip.dura / Math.max(hueco, 0.01), 1), 1.8);
      const t1 = t0 + clip.dura / velocidad;
      pista.push({ t0, t1, clip, texto: u.texto.replace(/[¿?¡!.,;:"«»()]/g, '').trim() });
      cursor = t1;
    });
    return { conMovimiento: pista.length, signos: unidades.filter((u) => u.tipo === 'signo').length };
  }

  // Pose y palabra en el instante t.
  function estadoEn(t) {
    let i = -1;
    for (let k = 0; k < pista.length && pista[k].t0 <= t; k++) i = k;
    const actual = pista[i], siguiente = pista[i + 1];
    if (actual && t <= actual.t1) {
      const k = (t - actual.t0) / (actual.t1 - actual.t0);
      return { pose: poseDeClip(actual.clip, k), texto: actual.texto, avance: k };
    }
    const desde = actual ? actual.clip.poses.at(-1) : REPOSO;
    const hasta = siguiente ? siguiente.clip.poses[0] : REPOSO;
    const inicio = actual ? actual.t1 : -Infinity, fin = siguiente ? siguiente.t0 : Infinity;
    if (fin - inicio <= PAUSA_LARGA) {                        // enlace directo de un signo al siguiente
      return { pose: mezclar(desde, hasta, suave((t - inicio) / (fin - inicio))), texto: '', avance: 0 };
    }
    if (t - inicio < A_REPOSO) return { pose: mezclar(desde, REPOSO, suave((t - inicio) / A_REPOSO)), texto: '', avance: 0 };
    if (fin - t < A_REPOSO) return { pose: mezclar(REPOSO, hasta, suave(1 - (fin - t) / A_REPOSO)), texto: '', avance: 0 };
    return { pose: REPOSO, texto: '', avance: 0 };
  }

  // ----- Boca: forma según la letra que "toca" de la palabra -----

  //            ancho  alto
  const BOCAS = {
    a: [0.17, 0.13], e: [0.19, 0.08], i: [0.21, 0.045], o: [0.12, 0.12], u: [0.08, 0.08],
    m: [0.16, 0], b: [0.16, 0], p: [0.16, 0], f: [0.15, 0.025], v: [0.15, 0.025],
    consonante: [0.15, 0.045],
  };

  function boca(texto, avance) {
    const letras = normalizar(texto).toLowerCase().replace(/[^a-zñ]/g, '');
    if (!letras) return null;                                   // sonrisa de reposo
    const x = Math.min(avance, 0.999) * letras.length;
    const forma = (c) => BOCAS[c] || BOCAS.consonante;
    const a = forma(letras[Math.floor(x)]), b = forma(letras[Math.min(Math.floor(x) + 1, letras.length - 1)]);
    const k = suave(x - Math.floor(x));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }

  // ----- Dibujo -----

  const DEDOS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  const PALMA = [0, 1, 5, 9, 13, 17];

  // opciones: pregunta (cejas arriba) y zoom (1 = hasta las caderas, con las manos en reposo a la vista; más = más cerca)
  function pintar(t, { pregunta = false, zoom = 1 } = {}) {
    const { pose: p, texto, avance } = estadoEn(t);
    const W = lienzo.width, H = lienzo.height;
    const u = W * 0.245 * zoom, ox = W / 2;                      // unidad = ancho de hombros
    const oy = H * 0.1 / zoom + 1.3 * u;                        // la cabeza siempre queda arriba, a la vista
    const X = (i) => ox + p[i] * u, Y = (i) => oy + p[i + 1] * u;
    const grosor = Math.max(2, W / 260) * Math.sqrt(zoom);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = TINTA;
    ctx.fillStyle = PAPEL;
    ctx.lineWidth = grosor;

    // Tronco: de los hombros hacia abajo, hasta salir del recuadro.
    const hix = X(2), hiy = Y(2), hdx = X(4), hdy = Y(4);
    ctx.beginPath();
    ctx.moveTo(hdx - 0.06 * u, H + 10);
    ctx.lineTo(hdx - 0.02 * u, hdy + 0.12 * u);
    ctx.quadraticCurveTo(hdx, hdy - 0.06 * u, hdx + 0.2 * u, hdy - 0.1 * u);
    ctx.lineTo(hix - 0.2 * u, hiy - 0.1 * u);
    ctx.quadraticCurveTo(hix, hiy - 0.06 * u, hix + 0.02 * u, hiy + 0.12 * u);
    ctx.lineTo(hix + 0.06 * u, H + 10);
    ctx.fill();
    ctx.stroke();

    // Cabeza y cara.
    const cx = X(0), cy = Y(0) - 0.1 * u, r = 0.46 * u;
    ctx.beginPath();                                            // cuello
    ctx.moveTo(cx - 0.13 * u, cy + r * 0.8); ctx.lineTo(cx - 0.13 * u, (hiy + hdy) / 2 - 0.08 * u);
    ctx.moveTo(cx + 0.13 * u, cy + r * 0.8); ctx.lineTo(cx + 0.13 * u, (hiy + hdy) / 2 - 0.08 * u);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();                                            // flequillo, como el personaje de las tarjetas
    for (let k = -3; k <= 3; k++) {
      ctx.moveTo(cx + k * 0.035 * u, cy - r);
      ctx.quadraticCurveTo(cx + k * 0.1 * u, cy - r * 0.8, cx + k * 0.115 * u, cy - r * (0.52 - Math.abs(k) * 0.03));
    }
    ctx.stroke();
    const parpadeo = (t % 4.3) < 0.12;
    const cejas = pregunta ? -0.1 : 0;                           // en una pregunta, cejas arriba
    for (const lado of [-1, 1]) {
      const ex = cx + lado * 0.17 * u, ey = cy - 0.02 * u;
      ctx.beginPath();
      if (parpadeo) { ctx.moveTo(ex - 0.04 * u, ey); ctx.lineTo(ex + 0.04 * u, ey); ctx.stroke(); }
      else { ctx.arc(ex, ey, 0.028 * u, 0, Math.PI * 2); ctx.fillStyle = TINTA; ctx.fill(); ctx.fillStyle = PAPEL; }
      ctx.beginPath();                                          // ceja
      ctx.moveTo(ex - lado * 0.07 * u, ey - (0.13 - cejas) * u);
      ctx.quadraticCurveTo(ex, ey - (0.17 - cejas * 1.6) * u, ex + lado * 0.07 * u, ey - (0.12 - cejas * 0.6) * u);
      ctx.stroke();
    }
    const forma = boca(texto, avance), by = cy + 0.22 * u;
    ctx.beginPath();
    if (!forma) { ctx.moveTo(cx - 0.09 * u, by - 0.01 * u); ctx.quadraticCurveTo(cx, by + 0.06 * u, cx + 0.09 * u, by - 0.01 * u); ctx.stroke(); }
    else if (forma[1] < 0.012) { ctx.moveTo(cx - forma[0] * u / 2, by); ctx.lineTo(cx + forma[0] * u / 2, by); ctx.stroke(); }
    else { ctx.ellipse(cx, by, forma[0] * u / 2, forma[1] * u / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }

    // Brazos y manos, encima de todo. Cada pieza es un "tubo": trazo negro y, por dentro, blanco.
    const borde = grosor * 0.8;
    const tubo = (puntos, ancho, cerrado = false) => {
      for (const [color, w] of [[TINTA, ancho + borde * 2], [PAPEL, ancho]]) {
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.fillStyle = color;
        ctx.beginPath();
        puntos.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (cerrado) { ctx.closePath(); ctx.fill(); }
        ctx.stroke();
      }
    };
    // Piezas de un brazo, cada una con su profundidad media (z menor = más cerca).
    const piezas = (hombro, codo, mano, zMano, zMuneca) => {
      const M = (k) => [X(mano + k * 2), Y(mano + k * 2)];
      const z = (lista) => lista.reduce((s, k) => s + p[zMano + k], 0) / lista.length;
      const lista = [
        { z: Infinity, pinta: () => tubo([[X(hombro), Y(hombro)], [X(codo), Y(codo)], M(0)], 0.16 * u) },
        { z: z(PALMA), pinta: () => tubo(PALMA.map(M), 0.055 * u, true) },
      ];
      DEDOS.forEach((dedo, k) => lista.push({ z: z(dedo), pinta: () => tubo(dedo.map(M), (k ? 0.058 : 0.066) * u) }));
      return { fondo: p[zMuneca], piezas: lista.sort((a, b) => b.z - a.z) };   // de lejos a cerca
    };
    const brazos = [piezas(4, 8, DER, Z_DER, Z_MUNECAS + 1), piezas(2, 6, IZQ, Z_IZQ, Z_MUNECAS)];
    brazos.sort((a, b) => b.fondo - a.fondo);                   // primero el brazo que queda detrás
    for (const brazo of brazos) for (const pieza of brazo.piezas) pieza.pinta();
    ctx.strokeStyle = TINTA; ctx.lineWidth = grosor; ctx.fillStyle = PAPEL;
    return texto;
  }

  return { iniciar, preparar, pintar };
})();
