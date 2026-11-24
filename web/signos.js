// Generador de signos propios.
//
// Un signo se describe con nuestra notación (forma de la mano, orientación, lugar y movimiento
// en fotogramas clave) y aquí se convierte en movimiento del avatar: se coloca la mano, se
// calcula la posición de cada dedo y se resuelve el brazo. No usa vídeos ni datos de terceros.
//
// Convenciones (por mano; la mano dominante es la derecha de quien signa):
//   x  + = hacia el lado de esa mano ("afuera"),  - = hacia el centro del cuerpo ("adentro")
//   y  + = arriba     z  + = hacia delante (lejos de quien signa, hacia quien mira)
//   Unidad = ancho de hombros; origen entre los hombros.

const Signos = (() => {
  const RAD = Math.PI / 180;

  // ---------- Vectores ----------
  const suma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const por = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const largo = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const l = largo(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mezcla = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

  const DIRECCIONES = {
    arriba: [0, 1, 0], abajo: [0, -1, 0], adelante: [0, 0, 1], atras: [0, 0, -1],
    afuera: [1, 0, 0], adentro: [-1, 0, 0],
  };
  // "arriba+adelante" = bisectriz. Un vector [x,y,z] también vale.
  function direccion(d) {
    if (Array.isArray(d)) return unit(d);
    return unit(d.split('+').reduce((s, n) => suma(s, DIRECCIONES[n.trim()]), [0, 0, 0]));
  }

  // ---------- Puntos del cuerpo (en el sistema de la mano) ----------
  const LUGARES = {
    frente: [0, 1.1, 0.2], ojos: [0, 0.84, 0.22], nariz: [0, 0.72, 0.27], boca: [0, 0.6, 0.27],
    barbilla: [0, 0.4, 0.22], mejilla: [0.2, 0.68, 0.2], oreja: [0.42, 0.82, 0.05], sien: [0.28, 0.98, 0.15],
    cuello: [0, 0.25, 0.17], hombro: [0.5, 0, 0.1], pecho: [0.12, -0.25, 0.22], vientre: [0, -0.8, 0.22],
    neutro: [0.3, -0.5, 0.6], cintura: [0.35, -1.1, 0.15],
  };

  // ---------- Formas de mano ----------
  // d: flexión de cada dedo (índice, corazón, anular, meñique): un número 0..1 (0 = recto, 1 = puño)
  //    o [mcp, pip, dip] en grados.   ab: separación entre dedos (grados, hacia el pulgar = +)
  //    p: pulgar { a: apertura desde el índice (0 = pegado, 90 = lateral, <0 = cruzado sobre la palma),
  //                f: [flexión base, media, punta] en grados }
  const FORMAS = {
    plana:   { d: [0, 0, 0, 0], ab: [0, 0, 0, 0], p: { a: 8, f: [0, 0, 0] } },
    abierta: { d: [0, 0, 0, 0], ab: [10, 3, -5, -14], p: { a: 55, f: [0, 0, 0] } },
    puño:    { d: [1, 1, 1, 1], ab: [0, 0, 0, 0], p: { a: -35, f: [30, 45, 20] } },     // pulgar sobre los dedos
    a:       { d: [1, 1, 1, 1], ab: [0, 0, 0, 0], p: { a: 5, f: [0, 0, 0] } },          // pulgar al lado
    indice:  { d: [0, 1, 1, 1], ab: [0, 0, 0, 0], p: { a: -25, f: [25, 40, 25] } },
    c:       { d: [[25, 30, 20], [25, 30, 20], [25, 30, 20], [25, 30, 20]], ab: [4, 0, -3, -6], p: { a: 55, f: [10, 25, 15] } },
    o:       { d: [[50, 55, 30], [52, 55, 30], [52, 55, 30], [50, 50, 30]], ab: [0, 0, 0, 0], p: { a: 35, f: [25, 40, 30] } },
    piña:    { d: [[35, 45, 25], [35, 45, 25], [35, 45, 25], [35, 45, 25]], ab: [-8, -3, 3, 8], p: { a: 28, f: [15, 35, 25] } },   // yemas juntas
    v:       { d: [0, 0, 1, 1], ab: [10, -8, 0, 0], p: { a: -30, f: [25, 40, 25] } },
    w:       { d: [0, 0, 0, 1], ab: [12, 0, -12, 0], p: { a: -25, f: [25, 40, 25] } },
    y:       { d: [1, 1, 1, 0], ab: [0, 0, 0, 12], p: { a: 80, f: [0, 0, 0] } },
    l:       { d: [0, 1, 1, 1], ab: [0, 0, 0, 0], p: { a: 85, f: [0, 0, 0] } },
    f:       { d: [[55, 60, 30], 0, 0, 0], ab: [0, 2, -4, -10], p: { a: 30, f: [25, 40, 25] } },   // índice y pulgar se tocan
    garra:   { d: [[5, 70, 40], [5, 70, 40], [5, 70, 40], [5, 70, 40]], ab: [6, 0, -4, -8], p: { a: 40, f: [20, 30, 20] } },
    pico:    { d: [[55, 70, 20], [55, 70, 20], [55, 70, 20], [55, 70, 20]], ab: [-6, -2, 2, 6], p: { a: 18, f: [20, 35, 20] } },
  };

  // Longitudes (anchos de hombro): base de cada dedo en la palma y sus tres falanges.
  const DEDO = [
    { base: 0.20, lado: 0.075, seg: [0.10, 0.06, 0.045] },   // índice
    { base: 0.21, lado: 0.027, seg: [0.11, 0.065, 0.05] },   // corazón
    { base: 0.20, lado: -0.022, seg: [0.10, 0.06, 0.045] },  // anular
    { base: 0.18, lado: -0.065, seg: [0.08, 0.045, 0.04] },  // meñique
  ];
  const PULGAR = { origen: [0.04, 0.05], seg: [0.07, 0.055, 0.045] };

  // Estilo cartoon: las manos se dibujan más grandes que las reales para que la forma se lea bien.
  const ESCALA_MANO = 1.6;
  DEDO.forEach((d) => { d.base *= ESCALA_MANO; d.lado *= ESCALA_MANO; d.seg = d.seg.map((s) => s * ESCALA_MANO); });
  PULGAR.origen = PULGAR.origen.map((v) => v * ESCALA_MANO);
  PULGAR.seg = PULGAR.seg.map((s) => s * ESCALA_MANO);

  const grados = (v, k) => (typeof v === 'number' ? [v * 85, v * 100, v * 70][k] : v[k]);

  // Mezcla dos formas (para pasar de una a otra durante el signo).
  function mezclarForma(a, b, k) {
    const dedo = (x, y) => [0, 1, 2].map((j) => grados(x, j) + (grados(y, j) - grados(x, j)) * k);
    return {
      d: a.d.map((x, i) => dedo(x, b.d[i])),
      ab: mezcla(a.ab, b.ab, k),
      p: { a: a.p.a + (b.p.a - a.p.a) * k, f: mezcla(a.p.f, b.p.f, k) },
    };
  }

  // Posición de los 21 puntos de la mano respecto a la muñeca, en el espacio de quien mira
  // (x derecha, y arriba, z hacia delante) a partir de dirección de los dedos f y de la palma p.
  function puntosDeMano(forma, f, p) {
    p = unit(resta(p, por(f, punto(p, f))));             // la palma es perpendicular a los dedos
    const t = unit(cruz(p, f));                          // lado del pulgar
    const R = [[0, 0, 0]];
    const coloca = (a, b, c) => suma(suma(por(f, a), por(t, b)), por(p, c));
    const dirFlexion = (dir0, ang) => unit(suma(por(dir0, Math.cos(ang)), por(p, -Math.sin(ang))));

    // Pulgar (puntos 1-4)
    const pa = forma.p.a * RAD;
    const dirP = unit(suma(por(f, Math.cos(pa)), por(t, Math.sin(pa))));
    let pos = coloca(PULGAR.origen[1], PULGAR.origen[0], 0);
    R.push(pos);
    let acum = 0;
    for (let k = 0; k < 3; k++) {
      acum += forma.p.f[k] * RAD;
      pos = suma(pos, por(dirFlexion(dirP, acum), PULGAR.seg[k]));
      R.push(pos);
    }
    // Índice, corazón, anular y meñique (puntos 5-20)
    DEDO.forEach((dedo, i) => {
      const sp = forma.ab[i] * RAD;
      const dir0 = unit(suma(por(f, Math.cos(sp)), por(t, Math.sin(sp))));
      let q = coloca(dedo.base, dedo.lado, 0);
      R.push(q);
      let ang = 0;
      for (let k = 0; k < 3; k++) {
        ang += grados(forma.d[i], k) * RAD;
        q = suma(q, por(dirFlexion(dir0, ang), dedo.seg[k]));
        R.push(q);
      }
    });
    return { R, f, p, t };
  }

  // Punto de contacto de la mano (para colocarlo en un lugar del cuerpo).
  function puntoDeContacto(R, nombre) {
    switch (nombre) {
      case 'indice': return R[8];
      case 'pulgar': return R[4];
      case 'corazon': return R[12];
      case 'meñique': return R[20];
      case 'nudillos': return por(suma(suma(R[5], R[9]), suma(R[13], R[17])), 0.25);
      case 'palma': return por(suma(suma(R[0], R[5]), suma(R[9], R[17])), 0.25);
      case 'muneca': return R[0];
      case 'puntas': default: return por(suma(suma(R[8], R[12]), suma(R[16], R[20])), 0.25);
    }
  }

  // ---------- Brazo: de la posición de la muñeca al codo ----------
  const L_BRAZO = 0.95, L_ANTEBRAZO = 0.85;
  function codoPara(hombro, muneca) {
    let d = resta(muneca, hombro);
    const alcance = Math.min(largo(d), L_BRAZO + L_ANTEBRAZO - 0.02);
    const dir = unit(d);
    const a = (L_BRAZO * L_BRAZO - L_ANTEBRAZO * L_ANTEBRAZO + alcance * alcance) / (2 * alcance);
    const h = Math.sqrt(Math.max(L_BRAZO * L_BRAZO - a * a, 0));
    const polo = [0.12, -1, -0.55];                      // el codo tiende a ir abajo, pegado al cuerpo y hacia atrás
    const perp = unit(resta(polo, por(dir, punto(polo, dir))));
    return suma(suma(hombro, por(dir, a)), por(perp, h));
  }

  // ---------- Fotogramas clave ----------
  const suave = (x) => x * x * (3 - 2 * x);
  const HOMBRO = [0.5, 0, 0];
  const REPOSO_MANO = { muneca: [0.6, -1.72, 0.1], codo: [0.68, -0.92, -0.05] };

  function resolverClave(clave, previa) {
    const forma = typeof clave.forma === 'string' ? FORMAS[clave.forma] : (clave.forma || previa.forma);
    const f = clave.dir ? direccion(clave.dir) : previa.f;
    const p = clave.pal ? direccion(clave.pal) : previa.p;
    return { t: clave.t, forma, f, p, clave: { ...previa.clave, ...clave } };
  }

  // Devuelve el movimiento de una mano: función (k de 0 a 1) -> {muneca, forma, f, p} o null si no se usa.
  function trayectoria(claves, formaInicial) {
    if (!claves || !claves.length) return null;
    let previa = { forma: FORMAS[formaInicial || 'plana'], f: [0, 1, 0], p: [0, 0, 1], clave: {} };
    const hitos = claves.map((c) => {
      const r = resolverClave(c, previa);
      const { R } = puntosDeMano(r.forma, r.f, r.p);
      const base = c.pos || (c.en ? LUGARES[c.en] : (previa.base || LUGARES.neutro));
      const destino = suma(base, c.desp || [0, 0, 0]);
      const contacto = puntoDeContacto(R, c.punto || previa.clave.punto || 'puntas');
      r.destino = destino;
      r.muneca = resta(destino, contacto);               // la muñeca queda donde haga falta para que el contacto llegue al lugar
      previa = { ...r, destino, base };
      return r;
    });
    return (k) => {
      k = Math.min(Math.max(k, 0), 1);
      let i = 0;
      while (i < hitos.length - 2 && hitos[i + 1].t <= k) i++;
      const a = hitos[i], b = hitos[Math.min(i + 1, hitos.length - 1)];
      const u = b.t > a.t ? suave(Math.min(Math.max((k - a.t) / (b.t - a.t), 0), 1)) : 1;
      return {
        muneca: mezcla(a.muneca, b.muneca, u),
        forma: mezclarForma(a.forma, b.forma, u),
        f: unit(mezcla(a.f, b.f, u)),
        p: unit(mezcla(a.p, b.p, u)),
      };
    };
  }

  // Repite las claves intermedias de un movimiento (p. ej. comer: la mano va y viene a la boca).
  function expandir(claves, repetir) {
    if (!claves || !repetir || repetir < 2) return claves;
    const n = claves.length, salida = [];
    for (let r = 0; r < repetir; r++) {
      claves.forEach((c, i) => {
        if (r > 0 && i === 0) return;
        salida.push({ ...c, t: (r * (n - 1) + i) / (repetir * (n - 1)) });
      });
    }
    salida[0].t = 0;
    return salida;
  }

  // ---------- Del signo al movimiento del avatar ----------
  // Devuelve { fotogramas: [{ cuerpo, izq, der, zi, zd, zm }], dura } con la misma forma que usa el avatar.
  function generar(signo, fps = 25) {
    const dominante = trayectoria(expandir(signo.d, signo.repetir), signo.formaInicial);
    const otra = trayectoria(expandir(signo.n, signo.repetir), signo.formaInicial);
    const dura = signo.dur || 1;
    const n = Math.max(Math.round(dura * fps), 2);
    const fotogramas = [];
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      // lado = -1 la derecha de quien signa (izquierda de la pantalla), +1 la izquierda.
      const mano = (tray, lado) => {
        if (!tray) return null;
        const e = tray(k);
        const { R } = puntosDeMano(e.forma, e.f, e.p);
        // x "afuera" es hacia el lado de esa mano; y de pantalla crece hacia abajo; z menor = más cerca de quien mira.
        const aPantalla = (v) => [lado * v[0], -v[1], -v[2]];
        const muneca3 = e.muneca;
        const codo = codoPara(HOMBRO, muneca3);
        const mundo = (v) => suma(muneca3, v);
        return {
          muneca: aPantalla(muneca3), codo: aPantalla(codo),
          puntos: R.map((v) => aPantalla(mundo(v))),
        };
      };
      const der = mano(dominante, -1), izq = mano(otra, 1);
      const cuerpo = [
        0, -0.72, 0.5, 0, -0.5, 0,
        izq ? izq.codo[0] : 0.68, izq ? izq.codo[1] : 0.92, der ? der.codo[0] : -0.68, der ? der.codo[1] : 0.92,
        izq ? izq.muneca[0] : 0.6, izq ? izq.muneca[1] : 1.72, der ? der.muneca[0] : -0.6, der ? der.muneca[1] : 1.72,
        0.33, 1.7, -0.33, 1.7,
      ];
      const plano = (m) => m && m.puntos.flatMap((v) => [v[0], v[1]]);
      const fondo = (m) => m && m.puntos.map((v) => v[2] - m.muneca[2]);
      fotogramas.push({
        cuerpo, izq: plano(izq), der: plano(der), zi: fondo(izq), zd: fondo(der),
        zm: [izq ? izq.muneca[2] : 0.3, der ? der.muneca[2] : 0.3],
      });
    }
    return { fotogramas, dura };
  }

  return { generar, FORMAS, LUGARES, puntosDeMano };
})();
