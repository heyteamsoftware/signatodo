// Avatar en 3D: el muñeco con volumen, sombreado y sombras proyectadas.
//
// Motor propio sobre WebGL (sin bibliotecas, para que funcione sin internet y dentro de la app). Todo se construye con
// una sola pieza básica, una "cápsula" (dos semiesferas unidas por un tronco de cono), que con distintas medidas hace de
// falange, antebrazo, tronco, cabeza, labio u ojo. Cada pieza se coloca por separado en cada fotograma.
//
// Se dibuja en tres pasadas:
//   1. sombras: la escena vista desde la luz, para saber qué tapa a qué (la mano da sombra sobre el pecho y la cara);
//   2. contorno: cada pieza un poco inflada y en color de tinta, vista por detrás (el trazo del dibujo);
//   3. color: cada material con su color, sombreado en tres tonos y con las sombras de la pasada 1.
//
// La cara es parte del modelo, no un dibujo pegado encima: la cabeza tiene un hueco de verdad donde se abre la boca, y por
// él se ven los dientes y la lengua, que están dentro; los labios son tubos que siguen la curva de la cara; los ojos son
// globos con su pupila y las cejas van en relieve. La cabeza es redonda: no tiene barbilla que se mueva.
//
// Coordenadas: x a la derecha de la pantalla, y hacia arriba, z hacia quien mira. Unidad = ancho de hombros.
// La vista tiene una perspectiva suave: los signos quedan casi donde se grabaron y lo que se acerca a quien mira se ve
// algo mayor. La profundidad se lee además por el sombreado y las sombras.

const Avatar3D = (() => {
  let lienzo = null, gl = null, listo = null;
  let prog = null, progSombra = null, malla = null, fbo = null, texSombra = null, texCara = null;
  let lienzoRostro = null;
  const TAM_SOMBRA = 1024, TAM_ROSTRO = 256;
  const LUZ = normalizar([-0.36, 0.55, 0.75]);          // de arriba a la izquierda y bastante de frente
  const CAMARA = [0, -0.35, 9];                          // eje a la altura del pecho; cámara a 9 anchos de hombro
  const ALCANCE_LUZ = 2.9, CENTRO_LUZ = [0, -0.75, 0.2], FONDO_LUZ = 4.5;

  // ---------- Aspecto: dibujo cálido ----------
  // Piel y pelo de persona, jersey oscuro y liso y guantes blancos: como visten los intérpretes, para que las manos
  // destaquen sobre el cuerpo y sobre la cara. El contorno es marrón oscuro, no negro.
  const ESTILO = {
    piel: [0.965, 0.835, 0.722], ropa: [0.141, 0.212, 0.31], guante: [1, 1, 1], pelo: [0.353, 0.227, 0.133],
    labio: [0.8, 0.45, 0.42], boca: [0.42, 0.12, 0.14], diente: [1, 1, 1], lengua: [0.9, 0.52, 0.52],
    ojo: [1, 1, 1], iris: [0.2, 0.12, 0.09], brillo: [1, 1, 1], ceja: [0.27, 0.17, 0.1],
    contorno: [0.18, 0.12, 0.09],
  };
  // Cómo recibe la luz cada material: [tonos planos (1) o degradado suave (0), luz mínima en sombra, sin sombrear (1)].
  // La piel va suave (un corte de tono en la cara parece barba); ropa, pelo y guantes, en tonos planos como un dibujo;
  // lo de dentro de la boca y los ojos no se sombrea: ahí dentro no llega la luz y saldrían grises.
  const LUZ_MATERIAL = {
    piel: [0, 0.89, 0], labio: [0, 0.86, 0], ropa: [1, 0.62, 0], pelo: [1, 0.7, 0], guante: [1, 0.72, 0],
    boca: [0, 1, 1], diente: [0, 1, 1], lengua: [0, 1, 1], ojo: [0, 1, 1], iris: [0, 1, 1], brillo: [0, 1, 1], ceja: [0, 1, 1],
  };
  const css = (c, alfa = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alfa})`;

  // ---------- Álgebra mínima ----------
  function normalizar(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const suma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mezcla = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const IDENTIDAD3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];                      // matrices 3x3 por columnas
  const mat3xVec = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const mat3xMat3 = (a, b) => { const c = new Array(9); for (let j = 0; j < 3; j++) { const col = mat3xVec(a, [b[j * 3], b[j * 3 + 1], b[j * 3 + 2]]); c[j * 3] = col[0]; c[j * 3 + 1] = col[1]; c[j * 3 + 2] = col[2]; } return c; };
  const traspuesta = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
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
    uniform vec3 uCabCentro; uniform mat3 uCabInv; uniform float uCabRadio;   // para saber dónde cae cada punto en la cara
    uniform float uPase;                             // 0 color y contorno, 1 sombras (vista desde la luz)
    varying vec3 vN, vLuz, vCab;
    void main() {
      vec3 centro = mix(uA, uB, aLado);
      float r = mix(uRA, uRB, aLado);
      vec3 n = normalize(uN * aDir);
      vec3 p = centro + r * (uM * aDir) + n * uContorno;
      vCab = uCabInv * (p - uCabCentro) / uCabRadio;                    // coordenadas de la cara: la cabeza es la esfera unidad
      vec3 w = uPivote + uGiro * (p - uPivote);
      vN = uGiro * n;
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
    uniform vec3 uColor, uLuz; uniform float uTinta, uCara, uTexel, uHueco, uTonos, uAmbiente, uPlano;
    uniform vec4 uBoca;                              // el hueco de la boca en la cara: media anchura, comisuras, borde de arriba y de abajo
    uniform sampler2D uSombra, uRostro;
    varying vec3 vN, vLuz, vCab;
    float profundidad(vec2 uv) { vec4 c = texture2D(uSombra, uv); return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
    float enLuz(vec3 pos, float sesgo) {
      vec2 uv = pos.xy * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
      float mia = pos.z * 0.5 + 0.5 + sesgo, suma = 0.0;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
        suma += step(profundidad(uv + vec2(float(i), float(j)) * uTexel * 1.6), mia);
      return suma / 9.0;
    }
    // La abertura de la boca: entre dos parábolas que van de comisura a comisura.
    bool enBoca(vec3 c) {
      if (uBoca.x < 0.001 || c.z <= 0.0) return false;
      float s = c.x / uBoca.x;
      if (abs(s) >= 1.0) return false;
      float f = 1.0 - s * s, y = -c.y;
      return y > uBoca.y + (uBoca.z - uBoca.y) * f && y < uBoca.y + (uBoca.w - uBoca.y) * f;
    }
    void main() {
      if (uHueco > 0.5 && enBoca(vCab)) discard;                       // por aquí se ve el interior de la boca
      if (uTinta > 0.5 || uPlano > 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
      vec3 n = normalize(vN);
      float incide = dot(n, uLuz);
      float directa = smoothstep(-0.08, 0.5, incide);
      float sombra = enLuz(vLuz, 0.0035 + 0.008 * (1.0 - max(incide, 0.0)));
      float t = directa * mix(0.25, 1.0, sombra);
      if (uTonos > 0.5) t = 0.5 * smoothstep(0.28, 0.34, t) + 0.5 * smoothstep(0.62, 0.68, t);   // tres tonos planos, como un dibujo
      float luz = mix(uAmbiente, 1.0, t);
      float canto = pow(1.0 - max(n.z, 0.0), 3.0);                     // se oscurece donde la superficie se aleja de la vista
      vec3 color = uColor * (luz - 0.07 * canto);
      if (uCara > 0.5 && vCab.z > 0.02) {
        // Lo poco que sigue pintado (flequillo, rubor) se proyecta de frente; cerca del borde se desvanece para no estirarse.
        vec4 rasgo = texture2D(uRostro, vec2(vCab.x * 0.5 + 0.5, 0.5 - vCab.y * 0.5));
        color = mix(color, rasgo.rgb * (luz - 0.07 * canto), rasgo.a * smoothstep(0.02, 0.24, vCab.z));
      }
      gl_FragColor = vec4(color, 1.0);
    }`;
  const FRAGMENTOS_SOMBRA = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying vec3 vN, vLuz, vCab;
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
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      lienzoRostro = document.createElement('canvas');
      lienzoRostro.width = lienzoRostro.height = TAM_ROSTRO;
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      listo = true;
    } catch (error) {
      console.warn('Avatar 3D no disponible:', error.message);
      listo = false;
    }
    return listo;
  }

  // ---------- Del esqueleto a las piezas ----------
  // Una pieza: { a, b, ra, rb, m, n, mat, cara, hueco, contorno }.  a = b para una esfera o un elipsoide.
  // mat: material (su color sale de ESTILO). contorno: grosor del trazo respecto al normal (0 = sin trazo).
  const capsula = (a, b, ra, rb, mat, contorno = 1) => { const m = baseHacia(a, b); return { a, b, ra, rb, m, n: m, mat, contorno }; };
  const esfera = (c, r, mat, contorno = 1) => ({ a: c, b: c, ra: r, rb: r, m: IDENTIDAD3, n: IDENTIDAD3, mat, contorno });
  // Elipsoide de semiejes (rx, ry, rz) girado con `giro`.
  const elipsoide = (c, rx, ry, rz, giro, mat, contorno = 1) => ({
    a: c, b: c, ra: 1, rb: 1, m: mat3xMat3(giro, escala3(rx, ry, rz)), n: mat3xMat3(giro, escala3(1 / rx, 1 / ry, 1 / rz)), mat, contorno,
  });

  // Profundidad de un brazo a partir del escorzo: un hueso mide siempre lo mismo, así que si se ve más corto es que apunta
  // hacia quien mira. Con una zona muerta para que un brazo casi de perfil no "flote" por el ruido de la medida.
  const L_BRAZO = 0.95, L_ANTEBRAZO = 0.85;
  // Grosor de los brazos (radios, en anchos de hombro), con proporciones de persona: el brazo mide de ancho como un
  // cuarto de los hombros, el antebrazo algo menos y la muñeca unos dos tercios de la palma.
  const R_HOMBRO = 0.14, R_BRAZO = [0.125, 0.105], R_ANTEBRAZO = [0.105, 0.108, 0.074];
  const escorzo = (largo, visto, muerta) => Math.max(Math.sqrt(Math.max(largo * largo - visto * visto, 0)) - muerta, 0);

  const R_CABEZA = 0.46;
  const CARA_REPOSO = { forma: [0.15, 0, 0, 0, 0, 0, 0, 0.5, 0], sonrisa: 0.25, cejas: 0, ceno: 0, ojos: 1, mirada: [0, 0], mejillas: 0 };

  // esqueleto: { cabeza, hombros:[i,d], codos:[i,d], munecas:[i,d], caderas:[i,d] } en (x, y) con y hacia arriba,
  //            manos: [izq, der], cada una 21 puntos [x, y, zRelativa] (z relativa a la muñeca, + = hacia quien mira),
  //            propia: manos del modelo propio (más grandes), gestos: { tronco:[lateral, adelante], cabeza:[lado, asiente, gira] } en grados,
  //            cara: { forma (los 9 números del sonido), sonrisa, cejas, ceno, ojos (0 cerrados … 1 abiertos), mirada:[x, y], mejillas }.
  function construir(esq) {
    const piezas = [], tramos = [];
    const [hI, hD] = esq.hombros;
    const medio = [(hI[0] + hD[0]) / 2, (hI[1] + hD[1]) / 2, 0];
    const cadera = (esq.caderas[0][1] + esq.caderas[1][1]) / 2;
    const RAD = Math.PI / 180;
    const cara = esq.cara || CARA_REPOSO;

    // Tronco de persona (medidas en anchos de hombro, tomadas de proporciones reales): el pecho es algo más estrecho que
    // los hombros y se estrecha hacia la cintura; debajo, las caderas. Una pieza de lado a lado hace la línea de los hombros,
    // de donde cuelgan los brazos.
    const R_CUELLO = [0.17, 0.155], R_CUELLO_JERSEY = 0.205;        // el cuello (base y arriba) y el cuello del jersey que lo envuelve
    const PECHO = 0.47, CINTURA = 0.41, CADERAS = 0.45, FONDO = 0.58, CUPULA = 0.5, R_HOMBROS = 0.125;
    const yPecho = medio[1] - 0.17, yCintura = medio[1] - 1.0;
    const aplastada = (a, b, ra, rb) => ({ a, b, ra, rb, m: escala3(1, CUPULA, FONDO), n: escala3(1, 1 / CUPULA, 1 / FONDO), mat: 'ropa', contorno: 1 });
    piezas.push(aplastada([medio[0], yCintura, 0], [medio[0], yPecho, 0], CINTURA, PECHO));            // pecho
    piezas.push(aplastada([medio[0], cadera, 0], [medio[0], yCintura, 0], CADERAS, CINTURA));          // de la cintura a las caderas
    piezas.push(aplastada([medio[0], cadera - 1.4, 0], [medio[0], cadera, 0], CADERAS, CADERAS));      // sigue hacia abajo, fuera del recuadro
    const yHombros = (hI[1] + hD[1]) / 2 - 0.02;
    piezas.push(capsula([hD[0], hD[1] - 0.02, -0.02], [hI[0], hI[1] - 0.02, -0.02], R_HOMBROS, R_HOMBROS, 'ropa'));
    // Del cuello a cada hombro, en pendiente (como caen los hombros de una persona), y el cuello del jersey.
    for (const hombro of [hI, hD]) {
      const lado = Math.sign(hombro[0] - medio[0]) || 1;
      piezas.push(capsula([medio[0] + lado * 0.19, medio[1] + 0.05, -0.03], [hombro[0] - lado * 0.05, hombro[1] + 0.005, -0.02], 0.085, 0.115, 'ropa'));
    }
    piezas.push({ a: [medio[0], medio[1] - 0.08, 0.02], b: [medio[0], medio[1] + 0.07, 0.02], ra: R_CUELLO_JERSEY, rb: R_CUELLO_JERSEY,
      m: escala3(1, 0.33, 1), n: escala3(1, 1 / 0.33, 1), mat: 'ropa', contorno: 1 });
    const anchoTronco = (y) => (y >= yCintura
      ? CINTURA + (PECHO - CINTURA) * Math.min((y - yCintura) / (yPecho - yCintura), 1)
      : CINTURA + (CADERAS - CINTURA) * Math.min((yCintura - y) / (yCintura - cadera), 1));
    const frenteTronco = (x, y) => {
      if (y > medio[1] + 0.14) return -Infinity;
      let z = -Infinity;
      const ancho = anchoTronco(y), k = (x - medio[0]) / ancho;
      if (Math.abs(k) < 1 && y <= yPecho + PECHO * CUPULA) z = ancho * FONDO * Math.sqrt(1 - k * k);
      if (Math.abs(y - yHombros) < R_HOMBROS && Math.abs(x - medio[0]) < 0.5 + R_HOMBROS) z = Math.max(z, R_HOMBROS - 0.02);   // línea de los hombros
      if (y > yHombros && Math.abs(x - medio[0]) < 0.3) z = Math.max(z, 0.18);                                            // cuello del jersey y arranque de los hombros
      return z;
    };

    // ----- Cabeza: gira de verdad sobre la base del cuello (ladea, asiente, gira) -----
    const R = R_CABEZA;
    const baseCuello = [medio[0], medio[1] + 0.06, 0.02];
    const centroCabeza0 = [esq.cabeza[0], esq.cabeza[1] + 0.1, 0.08];
    const g = esq.gestos.cabeza;
    const giroCabeza = mat3xMat3(rotZ(-g[0] * RAD), mat3xMat3(rotY(g[2] * RAD), rotX(g[1] * RAD)));
    const centroCabeza = suma(baseCuello, mat3xVec(giroCabeza, resta(centroCabeza0, baseCuello)));
    // De las coordenadas de la cara (x a la derecha, y hacia ABAJO, z hacia fuera; origen en el centro de la cabeza) al mundo.
    const enCara = (x, y, z) => suma(centroCabeza, mat3xVec(giroCabeza, [x, -y, z]));

    // La boca: de los nueve números del sonido a su geometría.
    const [ancho, alto, redondeo, dientesArriba, dientesAbajo, lenguaVista, lenguaSitio, aprieta, efe] = cara.forma;
    const sonrisa = cara.sonrisa;
    const AMPLIA = 1.12, Y_BOCA = 0.235;                                // la boca, algo mayor que la real y bajo la nariz
    const mw = Math.max(ancho * AMPLIA / 2 * (1 + 0.15 * sonrisa), 0.03);      // media anchura de la abertura
    const abre = alto * AMPLIA;                                         // abertura total
    const abierta = abre >= 0.014;
    const grosorLabio = (0.017 + 0.024 * redondeo) * (1 + 0.12 * aprieta);
    const yComisura = Y_BOCA - sonrisa * 0.03;                          // las comisuras suben al sonreír
    const arriba = abierta ? Y_BOCA - abre * 0.4 : Y_BOCA;              // se abre algo más hacia abajo que hacia arriba
    const abajoMandibula = abierta ? Y_BOCA + abre * 0.6 : Y_BOCA;
    const abajo = abierta && efe > 0.5 ? arriba + abre * 0.5 : abajoMandibula;   // f: el labio de abajo sube hasta los dientes

    // Superficie de la cara: la esfera de la cabeza, redonda. (Se probó una barbilla que bajaba al abrir la boca y quedaba
    // mal; la boca se abre dentro de la cara, sin deformarla.)
    const zCabeza = (x, y) => Math.sqrt(Math.max(R * R - x * x - y * y, 0));
    const zPiel = zCabeza;
    const enPiel = (x, y, fuera = 0) => enCara(x, y, zPiel(x, y) + fuera);

    piezas.push(capsula(baseCuello, enCara(0, R * 0.75, -0.03), R_CUELLO[0], R_CUELLO[1], 'piel'));          // cuello
    piezas.push({ a: centroCabeza, b: centroCabeza, ra: R, rb: R, m: giroCabeza, n: giroCabeza, mat: 'piel', cara: 1, hueco: 1, contorno: 1 });
    piezas.push(elipsoide(enCara(0, -0.15 * R, -0.16 * R), 1.035 * R, 1.035 * R, 1.035 * R, giroCabeza, 'pelo'));        // pelo: casquete por arriba y por detrás
    piezas.push(esfera(enCara(0, 0.045, zCabeza(0, 0.045) * 0.985), 0.034, 'piel', 0.45));                   // nariz

    // Labios: dos tubos de comisura a comisura que siguen la curva de la cara. Al redondear (o, u) se adelantan.
    const TRAMOS_LABIO = 6;
    const labio = (yMedio) => {
      const puntos = [];
      for (let i = 0; i <= TRAMOS_LABIO; i++) {
        const s = -1 + 2 * i / TRAMOS_LABIO, f = 1 - s * s;
        const x = s * (mw + grosorLabio * 0.4), y = yComisura + (yMedio - yComisura) * f;
        puntos.push({ p: enPiel(x, y, grosorLabio * 0.25 + redondeo * 0.05 * f), r: grosorLabio * (0.55 + 0.45 * f) });
      }
      for (let i = 0; i < TRAMOS_LABIO; i++) piezas.push(capsula(puntos[i].p, puntos[i + 1].p, puntos[i].r, puntos[i + 1].r, 'labio', 0));
    };
    labio(arriba - grosorLabio * 0.55);
    labio(abajo + grosorLabio * 0.65);

    // Dentro de la boca (solo se ve por el hueco): el fondo oscuro, los dientes y la lengua.
    if (abierta) {
      const zLabios = zCabeza(mw * 0.88, Y_BOCA);
      // El fondo cabe entero dentro de la cabeza: si fuera mayor asomaría por debajo de la cara.
      piezas.push(elipsoide(enCara(0, Y_BOCA + abre * 0.1, zCabeza(0, Y_BOCA) - 0.24), 0.17, 0.12, 0.08, giroCabeza, 'boca', 0));
      const R_DIENTE = 0.026;
      // Una fila de dientes: tan adentro como haga falta para que ni sus extremos asomen por la piel (solo se ve por el hueco).
      const fila = (y, medioAncho, extra) => {
        const borde = medioAncho + R_DIENTE * 0.8;
        const z = Math.min(zLabios, zPiel(borde, y - R_DIENTE * 0.8), zPiel(borde, y + R_DIENTE * 0.8)) - 0.014 - R_DIENTE - extra;
        piezas.push(capsula(enCara(-medioAncho, y, z), enCara(medioAncho, y, z), R_DIENTE, R_DIENTE, 'diente', 0));
      };
      if (dientesArriba > 0.05) fila(arriba + Math.max(abre * (0.16 + 0.4 * dientesArriba), 0.012) - R_DIENTE, mw * 0.88, 0);
      if (dientesAbajo > 0.05) fila(abajoMandibula - Math.max(abre * (0.12 + 0.3 * dientesAbajo), 0.01) + R_DIENTE, mw * 0.8, 0.01);
      if (lenguaVista > 0.08) {
        // Baja (vocales), contra los dientes de arriba (d, t, n, l) o asomando entre los dientes (z).
        const entre = lenguaSitio >= 1.5, alta = lenguaSitio >= 0.5 && !entre;
        const y = entre ? Y_BOCA + abre * 0.2 : (alta ? arriba + abre * 0.48 : abajoMandibula - abre * 0.24);
        const hondo = entre ? 0 : (alta ? 0.05 : 0.075);
        const gordo = Math.max(abre * 0.2 * Math.min(lenguaVista + 0.2, 1), 0.008) + 0.004;
        piezas.push(elipsoide(enCara(0, y, zCabeza(0, y) - hondo - 0.04), mw * (entre ? 0.6 : 0.5), gordo, 0.045, giroCabeza, 'lengua', 0));
      }
    }

    // Ojos: un globo blanco medio hundido en la cara, la pupila y un brillo. Cerrados, solo queda la raya (pintada).
    const xOjo = 0.17, yOjo = -0.02;
    for (const lado of [-1, 1]) {
      if (cara.ojos >= 0.15) {
        const k = Math.min(cara.ojos, 1.3);
        const zOjo = zCabeza(lado * xOjo, yOjo) - 0.03;
        piezas.push(elipsoide(enCara(lado * xOjo, yOjo, zOjo), 0.07, 0.085 * k, 0.05, giroCabeza, 'ojo', 0.55));
        const px = lado * xOjo + cara.mirada[0] * 0.022, py = yOjo - cara.mirada[1] * 0.02 + 0.006;
        piezas.push(elipsoide(enCara(px, py, zOjo + 0.036), 0.036, 0.042 * Math.min(k, 1), 0.02, giroCabeza, 'iris', 0));
        piezas.push(esfera(enCara(px - 0.013, py - 0.014, zOjo + 0.052), 0.011, 'brillo', 0));
      }
      // Cejas en relieve: suben, bajan y se fruncen.
      const base = yOjo - 0.135 - cara.cejas * 0.11, cen = cara.ceno * 0.085;
      const interior = [lado * xOjo - lado * 0.07, base + cen], exterior = [lado * xOjo + lado * 0.075, base + 0.012 - cen * 0.4];
      const cima = [lado * xOjo, (interior[1] + exterior[1]) / 2 - 0.018];
      piezas.push(capsula(enPiel(interior[0], interior[1], 0.012), enPiel(cima[0], cima[1], 0.012), 0.017, 0.018, 'ceja', 0));
      piezas.push(capsula(enPiel(cima[0], cima[1], 0.012), enPiel(exterior[0], exterior[1], 0.012), 0.018, 0.012, 'ceja', 0));
    }

    // Hasta dónde llega la cabeza hacia quien mira (con un margen por la nariz, los labios y los ojos).
    const frenteCabeza = (x, y) => {
      const dx = x - centroCabeza[0], dy = y - centroCabeza[1];
      let z = -Infinity;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R) z = centroCabeza[2] + Math.sqrt(R * R - d2) + 0.04;
      return z;
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

    // ----- Brazos y manos -----
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
      // Las manos grabadas son de tamaño real y a esta escala se leen mal: se agrandan un poco desde la muñeca (las del
      // modelo propio ya vienen grandes).
      const AMPLIA_MANO = esq.propia ? 1 : 1.15;
      const origen = esq.manos[lado][0];
      const mano = esq.manos[lado].map((q) => [origen[0] + (q[0] - origen[0]) * AMPLIA_MANO, origen[1] + (q[1] - origen[1]) * AMPLIA_MANO, q[2] * AMPLIA_MANO]);
      // La mano nunca queda dentro del cuerpo ni de la cabeza: si su sitio en la imagen cae sobre ellos, va por delante.
      let empuje = 0;
      for (const q of mano) {
        const libre = frente(q[0], q[1]) + rPalma + 0.03;
        empuje = Math.max(empuje, libre - (zMuneca + q[2]));
      }
      zMuneca += empuje;
      const codo = [c2[0], c2[1], zCodo + empuje * 0.35];
      const P = mano.map((q) => [q[0], q[1], zMuneca + q[2]]);
      // Brazo: hombro redondeado, brazo que se afina hacia el codo, y antebrazo con su forma (más ancho cerca del codo, fino
      // en la muñeca). El guante acaba en un puño que lo une al antebrazo.
      const vientre = mezcla(codo, P[0], 0.3), puno = mezcla(codo, P[0], 0.85);
      piezas.push(esfera(h, R_HOMBRO, 'ropa'));
      piezas.push(capsula(h, codo, R_BRAZO[0], R_BRAZO[1], 'ropa'));
      piezas.push(capsula(codo, vientre, R_ANTEBRAZO[0], R_ANTEBRAZO[1], 'ropa'));
      piezas.push(capsula(vientre, P[0], R_ANTEBRAZO[1], R_ANTEBRAZO[2], 'ropa'));
      piezas.push(capsula(puno, P[0], R_ANTEBRAZO[2] + 0.012, R_ANTEBRAZO[2] + 0.008, 'guante'));
      tramos.push({ a: h, b: codo, r: R_BRAZO[1], desde: 0.5 }, { a: codo, b: P[0], r: R_ANTEBRAZO[2], desde: 0 });
      for (const base of [1, 5, 9, 13, 17]) for (let k = 0; k < 3; k++) tramos.push({ a: P[base + k], b: P[base + k + 1], r: rDedo, desde: 0 });
      // Palma: los cuatro huesos hacia los nudillos, la línea de nudillos y la base del pulgar; juntos hacen una pieza continua.
      for (const k of [5, 9, 13, 17]) piezas.push(capsula(P[0], P[k], rPalma * 1.05, rPalma, 'guante'));
      for (const [i, j] of [[5, 9], [9, 13], [13, 17], [1, 5]]) piezas.push(capsula(P[i], P[j], rPalma * 0.95, rPalma * 0.95, 'guante'));
      piezas.push(capsula(P[0], P[1], rPalma * 1.05, rDedo * 1.25, 'guante'));
      // Dedos: tres falanges cada uno, cada una se mueve por su cuenta.
      for (const base of [1, 5, 9, 13, 17]) {
        const pulgar = base === 1;
        for (let k = 0; k < 3; k++) {
          const r0 = rDedo * (pulgar ? 1.2 : 1) * (1 - 0.07 * k), r1 = rDedo * (pulgar ? 1.2 : 1) * (1 - 0.07 * (k + 1));
          piezas.push(capsula(P[base + k], P[base + k + 1], r0, r1, 'guante'));
        }
      }
    }
    // Inclinación de todo el cuerpo alrededor de la cintura.
    const t = esq.gestos.tronco;
    const giro = mat3xMat3(rotZ(-t[0] * RAD), rotX(t[1] * RAD));
    return {
      piezas, giro, pivote: [medio[0], cadera, 0], tramos, frente,
      cabeza: { centro: centroCabeza, inversa: traspuesta(giroCabeza), radio: R },
      boca: abierta ? [mw / R, yComisura / R, arriba / R, abajo / R] : [0, 0, 0, 0],
    };
  }

  // Lo poco de la cara que sigue pintado sobre la cabeza: el flequillo, el rubor de las mejillas y, con los ojos cerrados,
  // su raya. La cabeza ocupa todo el lienzo; las medidas van en anchos de hombro con la y hacia abajo.
  function pintarRostro(cara) {
    const g = lienzoRostro.getContext('2d'), T = TAM_ROSTRO, c = T / 2, k = c / R_CABEZA;
    const X = (x) => c + x * k, Y = (y) => c + y * k;
    g.clearRect(0, 0, T, T);
    g.lineCap = g.lineJoin = 'round';
    // Flequillo: sale del casquete del pelo y cae sobre la frente en tres mechones.
    g.fillStyle = css(ESTILO.pelo);
    g.beginPath();
    g.arc(c, c, c * 1.02, Math.PI * 1.07, Math.PI * 1.93);
    g.quadraticCurveTo(X(0.36), Y(-0.34), X(0.2), Y(-0.215));
    g.quadraticCurveTo(X(0.1), Y(-0.31), X(-0.02), Y(-0.235));
    g.quadraticCurveTo(X(-0.14), Y(-0.33), X(-0.26), Y(-0.21));
    g.quadraticCurveTo(X(-0.38), Y(-0.32), X(-0.45), Y(-0.1));
    g.closePath();
    g.fill();
    // Rubor de las mejillas, difuminado.
    for (const lado of [-1, 1]) {
      const x = X(lado * 0.265), y = Y(0.12), r = 0.085 * k;
      const rubor = g.createRadialGradient(x, y, 0, x, y, r);
      rubor.addColorStop(0, 'rgba(238,118,104,0.42)'); rubor.addColorStop(1, 'rgba(238,118,104,0)');
      g.fillStyle = rubor; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = css(ESTILO.contorno); g.lineWidth = 0.02 * k;
    if (cara.ojos < 0.15) {                                             // ojos cerrados: una raya curva
      for (const lado of [-1, 1]) {
        g.beginPath(); g.moveTo(X(lado * 0.17 - 0.055), Y(-0.02)); g.quadraticCurveTo(X(lado * 0.17), Y(0.012), X(lado * 0.17 + 0.055), Y(-0.02)); g.stroke();
      }
    }
    if (cara.mejillas > 0.3) {                                          // mejillas infladas
      for (const lado of [-1, 1]) { g.beginPath(); g.arc(X(lado * 0.27), Y(0.225), 0.075 * k * cara.mejillas, 0, Math.PI * 2); g.stroke(); }
    }
  }

  // ---------- Dibujo ----------
  function ponerPieza(u, pz, contorno, color) {
    gl.uniform3fv(u.uA, pz.a); gl.uniform3fv(u.uB, pz.b);
    gl.uniform1f(u.uRA, pz.ra); gl.uniform1f(u.uRB, pz.rb);
    gl.uniformMatrix3fv(u.uM, false, pz.m); gl.uniformMatrix3fv(u.uN, false, pz.n);
    gl.uniform1f(u.uContorno, contorno);
    if (u.uColor) gl.uniform3fv(u.uColor, color);
    if (u.uCara) gl.uniform1f(u.uCara, pz.cara ? 1 : 0);
    if (u.uHueco) gl.uniform1f(u.uHueco, pz.hueco ? 1 : 0);
    if (u.uTonos) { const l = LUZ_MATERIAL[pz.mat]; gl.uniform1f(u.uTonos, l[0]); gl.uniform1f(u.uAmbiente, l[1]); gl.uniform1f(u.uPlano, l[2]); }
    gl.drawElements(gl.TRIANGLES, malla.n, gl.UNSIGNED_SHORT, 0);
  }

  function comunes(u, escena, vista, pase) {
    gl.uniformMatrix3fv(u.uGiro, false, escena.giro); gl.uniform3fv(u.uPivote, escena.pivote);
    gl.uniform4fv(u.uVista, vista);
    gl.uniform3fv(u.uCamara, CAMARA);
    gl.uniform1f(u.uPase, pase);
    if (u.uCabCentro) { gl.uniform3fv(u.uCabCentro, escena.cabeza.centro); gl.uniformMatrix3fv(u.uCabInv, false, escena.cabeza.inversa); gl.uniform1f(u.uCabRadio, escena.cabeza.radio); }
    const ejeX = normalizar(cruz([0, 1, 0], LUZ)), ejeY = cruz(LUZ, ejeX);
    gl.uniform3fv(u.uLuzX, ejeX); gl.uniform3fv(u.uLuzY, ejeY); gl.uniform3fv(u.uLuzZ, LUZ); gl.uniform3fv(u.uLuzCentro, CENTRO_LUZ);
    gl.uniform3fv(u.uLuzEscala, [1 / ALCANCE_LUZ, 1 / ALCANCE_LUZ, 1 / FONDO_LUZ]);
  }

  // opciones: { ancho, alto (píxeles), u (píxeles por ancho de hombros), ox, oy (píxeles del origen: centro de los hombros) }
  // Devuelve el lienzo WebGL ya pintado (o null si no hay WebGL).
  function pintar(esqueleto, { ancho, alto, u, ox, oy }) {
    if (!iniciar()) return null;
    if (lienzo.width !== ancho || lienzo.height !== alto) { lienzo.width = ancho; lienzo.height = alto; }
    const escena = construir(esqueleto);
    const vista = [2 * u / ancho, 2 * u / alto, 2 * ox / ancho - 1, 1 - 2 * oy / alto];
    pintarRostro(esqueleto.cara || CARA_REPOSO);

    // 1. Sombras: la escena vista desde la luz. Lo de dentro de la boca y los detalles mínimos no dan sombra.
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, TAM_SOMBRA, TAM_SOMBRA);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(progSombra.p);
    comunes(progSombra.u, escena, vista, 1);
    gl.cullFace(gl.BACK);
    for (const pz of escena.piezas) if (pz.contorno > 0 || pz.mat === 'labio' || pz.mat === 'ceja') ponerPieza(progSombra.u, pz, 0, null);

    // 2 y 3. Contorno y color, en el lienzo.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ancho, alto);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog.p);
    comunes(prog.u, escena, vista, 0);
    gl.uniform3fv(prog.u.uLuz, LUZ);
    gl.uniform1f(prog.u.uTexel, 1 / TAM_SOMBRA);
    gl.uniform4fv(prog.u.uBoca, escena.boca);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texSombra); gl.uniform1i(prog.u.uSombra, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texCara);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lienzoRostro);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(prog.u.uRostro, 1);
    const trazo = Math.max(0.013, 2.1 / u);                              // grosor del contorno, en anchos de hombro
    gl.cullFace(gl.FRONT);
    gl.uniform1f(prog.u.uTinta, 1);
    for (const pz of escena.piezas) if (pz.contorno > 0) ponerPieza(prog.u, pz, trazo * pz.contorno, ESTILO.contorno);
    gl.cullFace(gl.BACK);
    gl.uniform1f(prog.u.uTinta, 0);
    for (const pz of escena.piezas) ponerPieza(prog.u, pz, 0, ESTILO[pz.mat]);
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
