// Avatar en 3D: el mismo muñeco, con volumen, sombreado y sombras proyectadas.
//
// Motor propio sobre WebGL (sin bibliotecas, para que funcione sin internet y dentro de la app). Todo el cuerpo se
// construye con una sola pieza básica, una "cápsula" (dos semiesferas unidas por un tronco de cono), que con distintas
// medidas hace de falange, antebrazo, tronco o cabeza. Cada pieza se mueve por separado: 3 por dedo, palma, antebrazo,
// brazo, hombro, cuello, tronco y cabeza.
//
// Se dibuja en tres pasadas:
//   1. sombras: la escena vista desde la luz, para saber qué tapa a qué (la mano da sombra sobre el pecho y la cara);
//   2. contorno: cada pieza un poco inflada y en negro, vista por detrás (el trazo de tinta del muñeco);
//   3. color: blanco con sombreado suave según la luz y con las sombras de la pasada 1.
//
// Coordenadas: x a la derecha de la pantalla, y hacia arriba, z hacia quien mira. Unidad = ancho de hombros.
// La vista tiene una perspectiva suave: los signos quedan casi donde se grabaron y lo que se acerca a quien mira se ve
// algo mayor. La profundidad se lee además por el sombreado y las sombras.

const Avatar3D = (() => {
  let lienzo = null, gl = null, listo = null;
  let prog = null, progSombra = null, malla = null, fbo = null, texSombra = null, texCara = null;
  const TAM_SOMBRA = 1024;
  const LUZ = normalizar([-0.42, 0.62, 0.66]);          // de arriba a la izquierda y de frente
  const CAMARA = [0, -0.35, 9];                          // eje a la altura del pecho; cámara a 9 anchos de hombro
  const ALCANCE_LUZ = 2.9, CENTRO_LUZ = [0, -0.75, 0.2], FONDO_LUZ = 4.5;

  // ---------- Álgebra mínima ----------
  function normalizar(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const suma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const por = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const IDENTIDAD3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];                      // matrices 3x3 por columnas
  const mat3xVec = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const mat3xMat3 = (a, b) => { const c = new Array(9); for (let j = 0; j < 3; j++) { const col = mat3xVec(a, [b[j * 3], b[j * 3 + 1], b[j * 3 + 2]]); c[j * 3] = col[0]; c[j * 3 + 1] = col[1]; c[j * 3 + 2] = col[2]; } return c; };
  const escala3 = (x, y, z) => [x, 0, 0, 0, y, 0, 0, 0, z];
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
  // Base ortonormal cuyo eje "y" local apunta de a hacia b.
  function baseHacia(a, b) {
    const eje = normalizar(resta(b, a));
    const apoyo = Math.abs(eje[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e1 = normalizar(cruz(eje, apoyo));
    const e2 = cruz(e1, eje);
    return [e1[0], e1[1], e1[2], eje[0], eje[1], eje[2], e2[0], e2[1], e2[2]];
  }

  // ---------- Malla: esfera partida por el ecuador (las dos mitades se separan para hacer la cápsula) ----------
  function crearMalla() {
    const PARALELOS = 7, MERIDIANOS = 20;                               // por semiesfera
    const dir = [], lado = [], indices = [];
    const anillos = [];
    for (const mitad of [0, 1]) {
      for (let i = 0; i <= PARALELOS; i++) {
        const lat = mitad === 0 ? -Math.PI / 2 + (Math.PI / 2) * (i / PARALELOS) : (Math.PI / 2) * (i / PARALELOS);
        const anillo = [];
        for (let j = 0; j <= MERIDIANOS; j++) {
          const lon = 2 * Math.PI * j / MERIDIANOS;
          anillo.push(dir.length / 3);
          dir.push(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
          lado.push(mitad);
        }
        anillos.push(anillo);
      }
    }
    for (let a = 0; a + 1 < anillos.length; a++) {
      for (let j = 0; j < MERIDIANOS; j++) {
        const p0 = anillos[a][j], p1 = anillos[a][j + 1], q0 = anillos[a + 1][j], q1 = anillos[a + 1][j + 1];
        indices.push(p0, q0, p1, p1, q0, q1);                           // caras hacia fuera en sentido antihorario
      }
    }
    return { dir: new Float32Array(dir), lado: new Float32Array(lado), indices: new Uint16Array(indices) };
  }

  // ---------- Sombreadores ----------
  const VERTICES = `
    attribute vec3 aDir; attribute float aLado;
    uniform vec3 uA, uB; uniform float uRA, uRB; uniform mat3 uM, uN;
    uniform mat3 uGiro; uniform vec3 uPivote;        // inclinación de todo el cuerpo alrededor de la cintura
    uniform vec4 uVista;                             // escala x, escala y, origen x, origen y (a coordenadas de recorte)
    uniform float uContorno;
    uniform vec3 uCamara;                            // eje de la perspectiva (x, y) y distancia de la cámara
    uniform vec3 uLuzX, uLuzY, uLuzZ, uLuzCentro; uniform vec3 uLuzEscala;
    uniform float uPase;                             // 0 color y contorno, 1 sombras (vista desde la luz)
    varying vec3 vN, vLocal, vLuz;
    void main() {
      vec3 centro = mix(uA, uB, aLado);
      float r = mix(uRA, uRB, aLado);
      vec3 n = normalize(uN * aDir);
      vec3 p = centro + r * (uM * aDir) + n * uContorno;
      vec3 w = uPivote + uGiro * (p - uPivote);
      vN = uGiro * n; vLocal = aDir;
      vec3 q = w - uLuzCentro;
      vLuz = vec3(dot(q, uLuzX), dot(q, uLuzY), dot(q, uLuzZ)) * uLuzEscala;      // -1..1 en la vista de la luz
      if (uPase > 0.5) gl_Position = vec4(vLuz.xy, -vLuz.z, 1.0);
      else {
        // Perspectiva suave: lo que está más cerca de quien mira se ve algo mayor (se abre desde el eje del pecho).
        float k = uCamara.z / (uCamara.z - w.z);
        vec2 q2 = uCamara.xy + (w.xy - uCamara.xy) * k;
        gl_Position = vec4(q2.x * uVista.x + uVista.z, q2.y * uVista.y + uVista.w, -w.z * 0.18, 1.0);
      }
    }`;
  const FRAGMENTOS = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform vec3 uColor, uLuz; uniform float uTinta, uCara, uTexel;
    uniform sampler2D uSombra, uRostro;
    varying vec3 vN, vLocal, vLuz;
    float profundidad(vec2 uv) { vec4 c = texture2D(uSombra, uv); return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
    float enLuz(vec3 pos, float sesgo) {
      vec2 uv = pos.xy * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
      float mia = pos.z * 0.5 + 0.5 + sesgo, suma = 0.0;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
        suma += step(profundidad(uv + vec2(float(i), float(j)) * uTexel * 1.6), mia);
      return suma / 9.0;
    }
    void main() {
      if (uTinta > 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
      vec3 n = normalize(vN);
      float incide = dot(n, uLuz);
      float directa = smoothstep(-0.08, 0.5, incide);
      float sombra = enLuz(vLuz, 0.0035 + 0.008 * (1.0 - max(incide, 0.0)));
      float luz = mix(0.60, 1.0, directa * mix(0.25, 1.0, sombra));
      float canto = pow(1.0 - max(n.z, 0.0), 3.0);                     // se oscurece donde la superficie se aleja de la vista
      vec3 color = uColor * (luz - 0.10 * canto);
      if (uCara > 0.5 && vLocal.z > 0.02) {
        // Los rasgos se proyectan de frente sobre la esfera; cerca del borde se estirarían, así que ahí se desvanecen.
        vec4 rasgo = texture2D(uRostro, vec2(vLocal.x * 0.5 + 0.5, 0.5 - vLocal.y * 0.5));
        color = mix(color, rasgo.rgb * (0.78 + 0.22 * luz), rasgo.a * smoothstep(0.02, 0.24, vLocal.z));
      }
      gl_FragColor = vec4(color, 1.0);
    }`;
  const FRAGMENTOS_SOMBRA = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec3 vN, vLocal, vLuz;
    void main() {
      float z = clamp(vLuz.z * 0.5 + 0.5, 0.0, 0.9999);
      vec4 c = fract(z * vec4(1.0, 255.0, 65025.0, 16581375.0));
      c -= c.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
      gl_FragColor = c;
    }`;

  function compilar(fuenteV, fuenteF) {
    const hacer = (tipo, fuente) => {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, fuente); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, hacer(gl.VERTEX_SHADER, fuenteV)); gl.attachShader(p, hacer(gl.FRAGMENT_SHADER, fuenteF));
    gl.bindAttribLocation(p, 0, 'aDir'); gl.bindAttribLocation(p, 1, 'aLado');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  function iniciar() {
    if (listo !== null) return listo;
    try {
      lienzo = document.createElement('canvas');
      gl = lienzo.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('sin WebGL');
      prog = compilar(VERTICES, FRAGMENTOS);
      progSombra = compilar(VERTICES, FRAGMENTOS_SOMBRA);
      const m = crearMalla();
      malla = { n: m.indices.length };
      const bDir = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bDir); gl.bufferData(gl.ARRAY_BUFFER, m.dir, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const bLado = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bLado); gl.bufferData(gl.ARRAY_BUFFER, m.lado, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      const bInd = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bInd); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      // Mapa de sombras: una textura donde se guarda la profundidad vista desde la luz.
      texSombra = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texSombra);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TAM_SOMBRA, TAM_SOMBRA, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const fondo = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, fondo);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, TAM_SOMBRA, TAM_SOMBRA);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texSombra, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fondo);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('sin lienzo de sombras');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      texCara = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texCara);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      listo = true;
    } catch (error) {
      console.warn('Avatar 3D no disponible:', error.message);
      listo = false;
    }
    return listo;
  }

  // ---------- Del esqueleto a las piezas ----------
  // Una pieza: { a, b, ra, rb, m, n, color, cara }.  a = b para una esfera o un elipsoide.
  const BLANCO = [1, 1, 1], ROPA = [0.84, 0.87, 0.92];
  const capsula = (a, b, ra, rb, color) => { const m = baseHacia(a, b); return { a, b, ra, rb, m, n: m, color }; };
  const esfera = (c, r, color) => ({ a: c, b: c, ra: r, rb: r, m: IDENTIDAD3, n: IDENTIDAD3, color });

  // Profundidad de un brazo a partir del escorzo: un hueso mide siempre lo mismo, así que si se ve más corto es que apunta
  // hacia quien mira. Con una zona muerta para que un brazo casi de perfil no "flote" por el ruido de la medida.
  const L_BRAZO = 0.95, L_ANTEBRAZO = 0.85;
  // Grosor de los brazos (radios, en anchos de hombro), con proporciones de persona: el brazo mide de ancho como un
  // cuarto de los hombros, el antebrazo algo menos y la muñeca unos dos tercios de la palma.
  const R_HOMBRO = 0.14, R_BRAZO = [0.125, 0.105], R_ANTEBRAZO = [0.105, 0.108, 0.074];
  const mezcla = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const escorzo = (largo, visto, muerta) => Math.max(Math.sqrt(Math.max(largo * largo - visto * visto, 0)) - muerta, 0);

  // esqueleto: { cabeza, hombros:[i,d], codos:[i,d], munecas:[i,d], caderas:[i,d] } en (x, y) con y hacia arriba,
  //            manos: [izq, der], cada una 21 puntos [x, y, zRelativa] (z relativa a la muñeca, + = hacia quien mira),
  //            propia: manos del modelo propio (más grandes), gestos: { tronco:[lateral, adelante], cabeza:[lado, asiente, gira] } en grados.
  function construir(esq) {
    const piezas = [], tramos = [];
    const [hI, hD] = esq.hombros;
    const medio = [(hI[0] + hD[0]) / 2, (hI[1] + hD[1]) / 2, 0];
    const cadera = (esq.caderas[0][1] + esq.caderas[1][1]) / 2;
    const RAD = Math.PI / 180;

    // Tronco de persona (medidas en anchos de hombro, tomadas de proporciones reales): el pecho es algo más estrecho que
    // los hombros y se estrecha hacia la cintura; debajo, las caderas. Una pieza de lado a lado hace la línea de los hombros,
    // de donde cuelgan los brazos.
    const PECHO = 0.45, CINTURA = 0.37, CADERAS = 0.43, FONDO = 0.56, CUPULA = 0.5, R_HOMBROS = 0.125;
    const yPecho = medio[1] - 0.17, yCintura = medio[1] - 1.0;
    const aplastada = (a, b, ra, rb) => ({ a, b, ra, rb, m: escala3(1, CUPULA, FONDO), n: escala3(1, 1 / CUPULA, 1 / FONDO), color: ROPA });
    piezas.push(aplastada([medio[0], yCintura, 0], [medio[0], yPecho, 0], CINTURA, PECHO));            // pecho
    piezas.push(aplastada([medio[0], cadera, 0], [medio[0], yCintura, 0], CADERAS, CINTURA));          // de la cintura a las caderas
    piezas.push(aplastada([medio[0], cadera - 1.4, 0], [medio[0], cadera, 0], CADERAS, CADERAS));      // sigue hacia abajo, fuera del recuadro
    const yHombros = (hI[1] + hD[1]) / 2 - 0.02;
    piezas.push(capsula([hD[0], hD[1] - 0.02, -0.02], [hI[0], hI[1] - 0.02, -0.02], R_HOMBROS, R_HOMBROS, ROPA));
    const anchoTronco = (y) => (y >= yCintura
      ? CINTURA + (PECHO - CINTURA) * Math.min((y - yCintura) / (yPecho - yCintura), 1)
      : CINTURA + (CADERAS - CINTURA) * Math.min((yCintura - y) / (yCintura - cadera), 1));
    const frenteTronco = (x, y) => {
      if (y > medio[1] + 0.14) return -Infinity;
      let z = -Infinity;
      const ancho = anchoTronco(y), k = (x - medio[0]) / ancho;
      if (Math.abs(k) < 1 && y <= yPecho + PECHO * CUPULA) z = ancho * FONDO * Math.sqrt(1 - k * k);
      if (Math.abs(y - yHombros) < R_HOMBROS && Math.abs(x - medio[0]) < 0.5 + R_HOMBROS) z = Math.max(z, R_HOMBROS - 0.02);   // línea de los hombros
      return z;
    };

    // Cabeza: gira de verdad sobre la base del cuello (ladea, asiente, gira).
    const R_CABEZA = 0.46;
    const baseCuello = [medio[0], medio[1] + 0.06, 0.02];
    const centroCabeza0 = [esq.cabeza[0], esq.cabeza[1] + 0.1, 0.08];
    const g = esq.gestos.cabeza;
    const giroCabeza = mat3xMat3(rotZ(-g[0] * RAD), mat3xMat3(rotY(g[2] * RAD), rotX(g[1] * RAD)));
    const enCabeza = (v) => suma(baseCuello, mat3xVec(giroCabeza, resta(v, baseCuello)));
    const centroCabeza = enCabeza(centroCabeza0);
    piezas.push(capsula(baseCuello, suma(centroCabeza, mat3xVec(giroCabeza, [0, -R_CABEZA * 0.75, -0.03])), 0.155, 0.14, BLANCO));
    piezas.push({ a: centroCabeza, b: centroCabeza, ra: R_CABEZA, rb: R_CABEZA, m: giroCabeza, n: giroCabeza, color: BLANCO, cara: 1 });
    piezas.push(esfera(enCabeza(suma(centroCabeza0, [0, -0.04, R_CABEZA * 0.99])), 0.034, BLANCO));         // nariz
    const frenteCabeza = (x, y) => {
      const d2 = (x - centroCabeza[0]) ** 2 + (y - centroCabeza[1]) ** 2;
      return d2 < R_CABEZA * R_CABEZA ? centroCabeza[2] + Math.sqrt(R_CABEZA * R_CABEZA - d2) : -Infinity;
    };

    // Lo que hay que adelantar el extremo b de un tramo (a queda fijo) para que no atraviese el tronco ni la cabeza.
    const frente = (x, y) => Math.max(frenteTronco(x, y), frenteCabeza(x, y));
    const librar = (a, b, ra, rb, muestras) => {
      let zb = b[2];
      for (const k of muestras) {
        const libre = frente(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k) + ra + (rb - ra) * k + 0.015;
        if (libre > -Infinity) zb = Math.max(zb, a[2] + (libre - a[2]) / k);
      }
      return zb;
    };

    // Brazos y manos.
    for (const lado of [0, 1]) {
      const h = [esq.hombros[lado][0], esq.hombros[lado][1], 0];
      const c2 = esq.codos[lado], m2 = esq.munecas[lado];
      // En la grabación el brazo se veía entero, así que nunca estaba dentro del cuerpo: si un tramo cae sobre el tronco o la
      // cabeza, se adelanta lo justo para pasar por delante.
      let zCodo = 0.7 * escorzo(L_BRAZO, Math.hypot(c2[0] - h[0], c2[1] - h[1]), 0.18);
      zCodo = Math.min(librar(h, [c2[0], c2[1], zCodo], R_BRAZO[0], R_BRAZO[1], [0.5, 0.75, 1]), Math.max(zCodo, 0.8));
      let zMuneca = zCodo + escorzo(L_ANTEBRAZO, Math.hypot(m2[0] - c2[0], m2[1] - c2[1]), 0.24);
      zMuneca = librar([c2[0], c2[1], zCodo], [m2[0], m2[1], zMuneca], R_ANTEBRAZO[1], R_ANTEBRAZO[2], [0.25, 0.5, 0.75, 1]);
      const grosor = esq.propia ? 1.3 : 1.18;
      const rDedo = 0.032 * grosor, rPalma = 0.047 * grosor;
      // La mano nunca queda dentro del cuerpo ni de la cabeza: si su sitio en la imagen cae sobre ellos, va por delante.
      // Las manos grabadas son de tamaño real y a esta escala se leen mal: se agrandan un poco desde la muñeca (las del
      // modelo propio ya vienen grandes).
      const AMPLIA = esq.propia ? 1 : 1.15;
      const origen = esq.manos[lado][0];
      const mano = esq.manos[lado].map((q) => [origen[0] + (q[0] - origen[0]) * AMPLIA, origen[1] + (q[1] - origen[1]) * AMPLIA, q[2] * AMPLIA]);
      let empuje = 0;
      for (const q of mano) {
        const libre = Math.max(frenteTronco(q[0], q[1]), frenteCabeza(q[0], q[1])) + rPalma + 0.03;
        empuje = Math.max(empuje, libre - (zMuneca + q[2]));
      }
      zMuneca += empuje;
      const codo = [c2[0], c2[1], zCodo + empuje * 0.35];
      const P = mano.map((q) => [q[0], q[1], zMuneca + q[2]]);
      // Brazo: hombro redondeado, brazo que se afina hacia el codo, y antebrazo con su forma (más ancho cerca del codo, fino
      // en la muñeca). El guante acaba en un puño que lo une al antebrazo.
      const vientre = mezcla(codo, P[0], 0.3), puno = mezcla(codo, P[0], 0.85);
      piezas.push(esfera(h, R_HOMBRO, ROPA));
      piezas.push(capsula(h, codo, R_BRAZO[0], R_BRAZO[1], ROPA));
      piezas.push(capsula(codo, vientre, R_ANTEBRAZO[0], R_ANTEBRAZO[1], ROPA));
      piezas.push(capsula(vientre, P[0], R_ANTEBRAZO[1], R_ANTEBRAZO[2], ROPA));
      piezas.push(capsula(puno, P[0], R_ANTEBRAZO[2] + 0.012, R_ANTEBRAZO[2] + 0.008, BLANCO));
      tramos.push({ a: h, b: codo, r: R_BRAZO[1], desde: 0.5 }, { a: codo, b: P[0], r: R_ANTEBRAZO[2], desde: 0 });
      for (const base of [1, 5, 9, 13, 17]) for (let k = 0; k < 3; k++) tramos.push({ a: P[base + k], b: P[base + k + 1], r: rDedo, desde: 0 });
      // Palma: los cuatro huesos hacia los nudillos, la línea de nudillos y la base del pulgar; juntos hacen una pieza continua.
      for (const k of [5, 9, 13, 17]) piezas.push(capsula(P[0], P[k], rPalma * 1.05, rPalma, BLANCO));
      for (const [i, j] of [[5, 9], [9, 13], [13, 17], [1, 5]]) piezas.push(capsula(P[i], P[j], rPalma * 0.95, rPalma * 0.95, BLANCO));
      piezas.push(capsula(P[0], P[1], rPalma * 1.05, rDedo * 1.25, BLANCO));
      // Dedos: tres falanges cada uno, cada una se mueve por su cuenta.
      for (const base of [1, 5, 9, 13, 17]) {
        const pulgar = base === 1;
        for (let k = 0; k < 3; k++) {
          const r0 = rDedo * (pulgar ? 1.2 : 1) * (1 - 0.07 * k), r1 = rDedo * (pulgar ? 1.2 : 1) * (1 - 0.07 * (k + 1));
          piezas.push(capsula(P[base + k], P[base + k + 1], r0, r1, BLANCO));
        }
      }
    }
    // Inclinación de todo el cuerpo alrededor de la cintura.
    const t = esq.gestos.tronco;
    const giro = mat3xMat3(rotZ(-t[0] * RAD), rotX(t[1] * RAD));
    return { piezas, giro, pivote: [medio[0], cadera, 0], tramos, frente };
  }

  // ---------- Dibujo ----------
  function ponerPieza(u, pz, contorno) {
    gl.uniform3fv(u.uA, pz.a); gl.uniform3fv(u.uB, pz.b);
    gl.uniform1f(u.uRA, pz.ra); gl.uniform1f(u.uRB, pz.rb);
    gl.uniformMatrix3fv(u.uM, false, pz.m); gl.uniformMatrix3fv(u.uN, false, pz.n);
    gl.uniform1f(u.uContorno, contorno);
    if (u.uColor) gl.uniform3fv(u.uColor, pz.color);
    if (u.uCara) gl.uniform1f(u.uCara, pz.cara ? 1 : 0);
    gl.drawElements(gl.TRIANGLES, malla.n, gl.UNSIGNED_SHORT, 0);
  }

  function comunes(u, escena, vista, pase) {
    gl.uniformMatrix3fv(u.uGiro, false, escena.giro); gl.uniform3fv(u.uPivote, escena.pivote);
    gl.uniform4fv(u.uVista, vista);
    gl.uniform3fv(u.uCamara, CAMARA);
    gl.uniform1f(u.uPase, pase);
    const ejeX = normalizar(cruz([0, 1, 0], LUZ)), ejeY = cruz(LUZ, ejeX);
    gl.uniform3fv(u.uLuzX, ejeX); gl.uniform3fv(u.uLuzY, ejeY); gl.uniform3fv(u.uLuzZ, LUZ); gl.uniform3fv(u.uLuzCentro, CENTRO_LUZ);
    gl.uniform3fv(u.uLuzEscala, [1 / ALCANCE_LUZ, 1 / ALCANCE_LUZ, 1 / FONDO_LUZ]);
  }

  // opciones: { ancho, alto (píxeles), u (píxeles por ancho de hombros), ox, oy (píxeles del origen: centro de los hombros), rostro (canvas con los rasgos) }
  // Devuelve el lienzo WebGL ya pintado (o null si no hay WebGL).
  function pintar(esqueleto, { ancho, alto, u, ox, oy, rostro }) {
    if (!iniciar()) return null;
    if (lienzo.width !== ancho || lienzo.height !== alto) { lienzo.width = ancho; lienzo.height = alto; }
    const escena = construir(esqueleto);
    const vista = [2 * u / ancho, 2 * u / alto, 2 * ox / ancho - 1, 1 - 2 * oy / alto];

    // 1. Sombras: la escena vista desde la luz.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, TAM_SOMBRA, TAM_SOMBRA);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(progSombra.p);
    comunes(progSombra.u, escena, vista, 1);
    gl.cullFace(gl.BACK);
    for (const pz of escena.piezas) ponerPieza(progSombra.u, pz, 0);

    // 2 y 3. Contorno y color, en el lienzo.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ancho, alto);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog.p);
    comunes(prog.u, escena, vista, 0);
    gl.uniform3fv(prog.u.uLuz, LUZ);
    gl.uniform1f(prog.u.uTexel, 1 / TAM_SOMBRA);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texSombra); gl.uniform1i(prog.u.uSombra, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCara);
    if (rostro) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rostro);
      // La cara se ve mucho más pequeña que su textura: con niveles reducidos no parpadean las líneas finas.
      if ((rostro.width & (rostro.width - 1)) === 0 && rostro.width === rostro.height) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
    }
    gl.uniform1i(prog.u.uRostro, 1);
    const trazo = Math.max(0.013, 2.1 / u);                              // grosor del contorno, en anchos de hombro
    gl.cullFace(gl.FRONT);
    gl.uniform1f(prog.u.uTinta, 1);
    for (const pz of escena.piezas) { const c = pz.color; pz.color = [0.07, 0.07, 0.07]; ponerPieza(prog.u, pz, trazo); pz.color = c; }
    gl.cullFace(gl.BACK);
    gl.uniform1f(prog.u.uTinta, 0);
    for (const pz of escena.piezas) ponerPieza(prog.u, pz, 0);
    return lienzo;
  }

  // Para las pruebas: cuánto se mete en el cuerpo o en la cabeza el eje del tramo de brazo o de dedo que más se mete
  // (en anchos de hombro; 0 o menos = ninguno atraviesa).
  function penetracion(esqueleto) {
    const escena = construir(esqueleto);
    let peor = -Infinity;
    for (const tr of escena.tramos) {
      for (let i = 0; i <= 10; i++) {
        const k = tr.desde + (1 - tr.desde) * i / 10;
        const x = tr.a[0] + (tr.b[0] - tr.a[0]) * k, y = tr.a[1] + (tr.b[1] - tr.a[1]) * k, z = tr.a[2] + (tr.b[2] - tr.a[2]) * k;
        const superficie = escena.frente(x, y);
        if (superficie > -Infinity) peor = Math.max(peor, superficie - z);
      }
    }
    return peor;
  }

  return { pintar, disponible: iniciar, penetracion };
})();
