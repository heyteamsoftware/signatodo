// Avatar 2D de trazo de línea: reproduce los signos enlazándolos con fluidez.
//
// Cada signo es un clip de movimiento (banco/poses/<id>.json) extraído de un vídeo de
// referencia: 9 puntos del cuerpo y 21 por mano, con origen entre los hombros y el
// ancho de hombros como unidad, más la profundidad de cada punto de las manos. Aquí se
// encadenan los clips, se interpola entre el final de uno y el principio del siguiente,
// y se dibuja un personaje minimalista con cara (cejas, ojos, boca que vocaliza).

const Avatar = (() => {
  const TRANSICION = 0.25;      // enlace medio entre dos signos, para calcular si una frase cabe
  const A_REPOSO = 0.45;        // lo que tarda en bajar o subir las manos
  const PAUSA_LARGA = 1.3;      // con un hueco mayor, las manos vuelven a reposo entre signos
  const TINTA = '#111', PAPEL = '#fff';

  let lienzo, ctx;
  // Por defecto se usa el movimiento extraído de vídeos de una persona real (banco/poses), con los gestos
  // de cuerpo, cara y ojos de los signos propios por encima. Con ?soloPropios=1 se usan solo los signos propios.
  const SOLO_PROPIOS = new URLSearchParams(location.search).has('soloPropios');
  let indice = {};              // referencia (terceros): clave normalizada -> id de clip
  let definiciones = {};        // signos propios: id -> definición
  const propios = {};           // signos propios: palabra normalizada -> id
  const gestosPalabra = {};     // gestos no manuales de la lista de 500: palabra normalizada -> nm
  let CAPA_MANO = null;          // lienzo auxiliar donde se dibuja y sombrea cada mano
  let expresiones = [];         // capa de expresión por frase: {t0, t1, d, shake, nod, nombre}
  const sinonimos = {};         // palabra normalizada -> { a: palabra con signo, relacion, confianza }
  const compuestos = {};        // signos compuestos: expresión normalizada -> partes
  let letrasDef = {};           // alfabeto dactilológico propio: letra -> definición
  const clips = {};             // id -> clip ya convertido a poses
  let pista = [];               // signos colocados en el tiempo
  let esPropio = true;          // el signo que se está dibujando es de creación propia (manos más grandes)
  let escalaTiempo = 1;        // 1 / velocidad del vídeo: el avatar signa a ritmo real aunque se frene al orador

  // ----- Poses -----
  // Una pose es una lista de 146 números:
  //   0-17    cuerpo (x, y): nariz, hombros i/d, codos i/d, muñecas i/d, caderas i/d
  //   18-59   mano izquierda, 21 puntos (x, y)        60-101  mano derecha
  //   102-122 profundidad de los 21 puntos de la izquierda   123-143  de la derecha
  //   144-145 profundidad de cada muñeca (menor = más cerca de quien mira)
  const IZQ = 18, DER = 60, Z_IZQ = 102, Z_DER = 123, Z_MUNECAS = 144;
  const CEROS = new Array(21).fill(0);
  //   146-158 gestos no manuales (ver signos.js): inclinación, cabeza, cejas, ojos, mirada, boca
  const NM = 146, NM_N = 13, NM_NEUTRO = Signos.NM_NEUTRO;

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

  function pose(cuerpo, izq, der, zi, zd, zm, nm) {
    return cuerpo.concat(
      izq || manoRelajada(cuerpo[10], cuerpo[11], 1), der || manoRelajada(cuerpo[12], cuerpo[13], -1),
      (izq && zi) || CEROS, (der && zd) || CEROS, zm || [0, 0], nm || NM_NEUTRO);
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
    return nucleo(poses, clip.fps, clip.cara ? clip.cara.map((r) => r.map((v) => v / 1000)) : null);
  }

  // Se queda con el núcleo del signo. El clip grabado es la forma "de diccionario": sale del
  // reposo, hace el signo y vuelve. Signando seguido eso sobra: el recorrido lo hace el enlace
  // con el signo anterior y el siguiente. Núcleo = tramo en que alguna mano está, al menos,
  // al 50 % de lo más lejos que llega a estar de su punto de partida.
  function nucleo(poses, fps, cara = null) {
    const lejos = poses.map((p) => Math.max(...[10, 12].map((i) => Math.min(
      Math.hypot(p[i] - poses[0][i], p[i + 1] - poses[0][i + 1]),
      Math.hypot(p[i] - poses.at(-1)[i], p[i + 1] - poses.at(-1)[i + 1])))));
    const umbral = 0.5 * Math.max(...lejos);
    let a = lejos.findIndex((d) => d >= umbral), b = lejos.findLastIndex((d) => d >= umbral);
    a = Math.max(a - 1, 0); b = Math.min(b + 1, poses.length - 1);
    if (b - a < 6) { a = Math.max(a - 3, 0); b = Math.min(b + 3, poses.length - 1); }   // nunca menos de ~0,25 s
    const recorte = poses.slice(a, b + 1);
    return { poses: recorte, dura: (recorte.length - 1) / fps, cara: cara ? cara.slice(a, b + 1) : null };
  }

  // El enlace entre dos signos dura según lo que tengan que viajar las manos.
  function enlace(desde, hasta) {
    const viaje = Math.max(...[10, 12].map((i) => Math.hypot(desde[i] - hasta[i], desde[i + 1] - hasta[i + 1])));
    return Math.min(0.14 + 0.13 * viaje, 0.4);
  }

  // Cara grabada (boca, cejas) en el avance k del clip, o null si el clip no la guarda.
  function caraDeClip(clip, k) {
    if (!clip.cara || !clip.cara.length) return null;
    const x = Math.min(Math.max(k, 0), 1) * (clip.cara.length - 1);
    const a = Math.floor(x), b = Math.min(a + 1, clip.cara.length - 1), f = x - a;
    return clip.cara[a].map((v, i) => v + (clip.cara[b][i] - v) * f);
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
    // Signos propios (nuestra notación): aportan los gestos no manuales y cubren palabras sin vídeo.
    try {
      definiciones = {};
      for (const url of await (await fetch('/api/propios')).json()) {
        const r = await fetch(url);
        if (r.ok) Object.assign(definiciones, (await r.json()).signos);
      }
    } catch { /* sin signos propios */ }
    for (const [id, s] of Object.entries(definiciones)) for (const palabra of s.palabras) { const clave = normalizar(palabra); if (clave) propios[clave] = id; }
    // Gestos no manuales de la lista de 500 signos (para palabras con movimiento extraído).
    try {
      const r = await fetch('/banco/propios/gestos.json');
      if (r.ok) for (const [palabra, nm] of Object.entries((await r.json()).gestos)) { const clave = normalizar(palabra); if (clave) gestosPalabra[clave] = nm; }
    } catch { /* sin gestos de la lista */ }
    await cargarLemas();
    try {
      const r = await fetch('/banco/propios/sinonimos.json');
      if (r.ok) for (const [clave, s] of Object.entries((await r.json()).sinonimos)) { const k = normalizar(clave); if (k) sinonimos[k] = { ...s, a: normalizar(s.a) }; }
    } catch { /* sin sinónimos */ }
    try {
      const r = await fetch('/banco/propios/compuestos.json');
      if (r.ok) for (const [clave, partes] of Object.entries((await r.json()).compuestos)) { const k = normalizar(clave); if (k) compuestos[k] = partes; }
    } catch { /* sin compuestos */ }
    try {
      const r = await fetch('/banco/propios/alfabeto.json');
      if (r.ok) letrasDef = (await r.json()).letras;
    } catch { /* sin alfabeto */ }
    // Movimiento extraído de vídeos de una persona real signando.
    if (!SOLO_PROPIOS) {
      try {
        const r = await fetch('/banco/poses/indice.json');
        indice = r.ok ? await r.json() : {};
      } catch { indice = {}; }
    }
    return Object.keys(propios).length;
  }

  // Movimiento de un signo propio, ya como poses del avatar.
  function crearPropio(id) {
    const { fotogramas, dura } = Signos.generar(definiciones[id]);
    return { poses: fotogramas.map((f) => pose(f.cuerpo, f.izq, f.der, f.zi, f.zd, f.zm, f.nm)), dura, propio: true };
  }

  // Una letra del alfabeto dactilológico, ya como poses del avatar.
  function crearLetra(letra) {
    const { fotogramas, dura } = Signos.generar(letrasDef[letra]);
    return { poses: fotogramas.map((f) => pose(f.cuerpo, f.izq, f.der, f.zi, f.zd, f.zm, f.nm)), dura, propio: true };
  }

  // Pone sobre un movimiento extraído los gestos de cuerpo, cara y ojos de un signo propio.
  function aplicarGestos(clip, ref) {     // ref: 'o:<id>' (signo propio) o 'g:<palabra>' (gestos de la lista de 500)
    const nm = ref.startsWith('o:') ? definiciones[ref.slice(2)].nm : gestosPalabra[ref.slice(2)];
    const gestos = Signos.gestos({ nm });
    const n = clip.poses.length;
    clip.poses.forEach((p, i) => p.splice(NM, NM_N, ...gestos(n > 1 ? i / (n - 1) : 0)));
  }

  // Une las palabras seguidas que forman una expresión con signo ("por favor", "de nada", "fin de semana").
  function fusionarFrases(unidades) {
    const hay = (c) => propios[c] !== undefined || indice[c] !== undefined || compuestos[c] !== undefined;
    const salida = [];
    for (let i = 0; i < unidades.length;) {
      let unida = false;
      for (let n = Math.min(4, unidades.length - i); n >= 2 && !unida; n--) {
        const grupo = unidades.slice(i, i + n);
        if (grupo.some((u) => u.seg !== grupo[0].seg)) continue;            // no cruza de una frase a otra
        const texto = grupo.map((u) => u.texto).join(' ');
        if (hay(normalizar(texto))) {
          salida.push({ ...grupo[0], t1: grupo.at(-1).t1, texto, lema: '', tarjeta: '', tipo: 'deletreo' });
          i += n; unida = true;
        }
      }
      if (!unida) { salida.push(unidades[i]); i++; }
    }
    return salida;
  }

    // Qué clip se usa para unas palabras candidatas: movimiento extraído (con gestos propios o de la lista
    // de 500 encima) si existe; si no, el signo propio.
  function resolverId(cands) {
      const propia = cands.find((c) => propios[c] !== undefined);
      const extraida = cands.find((c) => indice[c] !== undefined);
      if (extraida !== undefined) {
        const gesto = cands.find((c) => gestosPalabra[c] !== undefined);
        const ref = propia !== undefined && definiciones[propios[propia]].nm ? '|o:' + propios[propia] : (gesto !== undefined ? '|g:' + gesto : '');
        return String(indice[extraida]) + ref;
      }
      return propia !== undefined ? 'o:' + propios[propia] : undefined;
    }

  // Qué clips corresponden a una unidad (una palabra): uno o varios (compuestos, deletreo).
  function elegirUnidad(u, i, unidades, tarjetas, elegidas, { porSinonimo, sinSigno, deletreadas }) {
      const etiqueta = tarjetas[u.tarjeta]?.etiqueta || '';
      const candidatas = [normalizar(u.texto), normalizar(u.lema || ''), normalizar(etiqueta), normalizar((u.tarjeta || '').replace(/ny/g, 'ñ').replace(/-/g, ' '))].filter(Boolean);
      let id = resolverId(candidatas);
      // Sin signo con esa palabra: se prueba una equivalencia (saludo -> saludar, automóvil -> coche).
      if (id === undefined) {
        const clave = candidatas.find((c) => sinonimos[c] !== undefined && resolverId([sinonimos[c].a]) !== undefined);
        if (clave !== undefined) { id = resolverId([sinonimos[clave].a]); if (u.tipo !== 'omitir') porSinonimo.push(`${u.texto.replace(/[.,;:!?¡¿]/g, '')} → ${sinonimos[clave].a}`); }
      }
      const compuesto = id === undefined ? candidatas.find((c) => compuestos[c] !== undefined) : undefined;
      // También se signan las palabras sin tarjeta (por ejemplo "yo", "hola") si tienen movimiento o signo propio.
      const deletreable = u.tipo === 'deletreo' && Array.isArray(u.letras) && u.letras.some((l) => letrasDef[l]);
      if (u.tipo !== 'signo' && !(u.tipo === 'deletreo' && (id !== undefined || compuesto !== undefined || deletreable))) return;
      // "complemento" = viene tras una preposición ("en la cocina", "con mantequilla"): es lo primero
      // que se sacrifica, después del relleno, si hay que condensar.
      const anterior = unidades[i - 1];
      const complemento = !!anterior && anterior.tipo === 'omitir' && PREPOSICIONES.has(normalizar(anterior.texto));
      if (id !== undefined) {
        elegidas.push({ u, id, complemento });
      } else if (compuesto !== undefined) {
        // Signo compuesto: se encadenan sus partes repartiendo el tiempo de la palabra.
        const partes = compuestos[compuesto], parte = (u.t1 - u.t0) / partes.length;
        partes.forEach((p, k) => {
          const idParte = resolverId([normalizar(p)]);
          if (idParte !== undefined) elegidas.push({ u: { ...u, t0: u.t0 + k * parte, t1: u.t0 + (k + 1) * parte, texto: p }, id: idParte, complemento });
        });
      } else if (deletreable) {
        // Sin signo: se deletrea. Un nombre propio (con mayúscula, no a principio de frase) no se recorta nunca.
        const primera = i === 0 || unidades[i - 1].seg !== u.seg;
        const nombre = /^[A-ZÁÉÍÓÚÑ]/.test(u.texto) && !primera;
        const letras = u.letras.filter((l) => letrasDef[l]), parte = (u.t1 - u.t0) / letras.length;
        const sigla = /^[A-ZÁÉÍÓÚÑ]{2,}$/.test(u.texto);
        // Una palabra común sin signo y larga no se deletrea (los subtítulos ya la muestran): solo nombres,
        // siglas y palabras de hasta 4 letras.
        if (nombre || sigla || letras.length <= 4) {
          deletreadas.push(u.texto.replace(/[.,;:!?¡¿]/g, ''));
          letras.forEach((l, k) => elegidas.push({
            u: { ...u, t0: u.t0 + k * parte, t1: u.t0 + (k + 1) * parte, texto: l.toUpperCase() },
            id: 'l:' + l, complemento, deletreo: true, nombre: nombre || sigla, grupo: 'd' + i,
          }));
        } else sinSigno.push(u.texto.replace(/[.,;:!?¡¿]/g, ''));
      } else if (u.tipo === 'signo') sinSigno.push(u.texto.replace(/[.,;:!?¡¿]/g, ''));
  }

  // Descarga (o crea) los clips que faltan.
  async function cargarClips(elegidas) {
    await Promise.all([...new Set(elegidas.map((e) => e.id))].filter((id) => !clips[id]).map(async (id) => {
      if (String(id).startsWith('o:')) { clips[id] = crearPropio(id.slice(2)); return; }
      if (String(id).startsWith('l:')) { clips[id] = crearLetra(id.slice(2)); return; }
      const [idExtraido, idPropio] = String(id).split('|');
      const r = await fetch(`/banco/poses/${idExtraido}.json`);
      if (!r.ok) return;
      const clip = convertir(await r.json());
      if (idPropio) aplicarGestos(clip, idPropio);
      clips[id] = clip;
    }));
  }

  // unidades: las de <video>.signos.json; tarjetas: banco.tarjetas (para probar también con su etiqueta)
  async function preparar(unidades, tarjetas, segmentos, velocidadVideo = 1) {
    // Si el vídeo se reproduce más despacio, el orador dura más pero las manos no: se planifica en
    // tiempo real (segundos de reloj), no en tiempo del vídeo. Por eso se reescalan los tiempos.
    escalaTiempo = 1 / velocidadVideo;
    const aReloj = (x) => ({ ...x, t0: x.t0 * escalaTiempo, t1: x.t1 * escalaTiempo });
    unidades = unidades.map(aReloj);
    segmentos = segmentos.map(aReloj);
    pista = [];
    expresiones = [];
    // Expresiones de varias palabras ("por favor", "de nada", "fin de semana"): se fusionan en una sola unidad.
    unidades = fusionarFrases(unidades).map((u, idx) => ({ ...u, idx }));
    const elegidas = [];
    const porSinonimo = [], sinSigno = [], deletreadas = [];
    unidades.forEach((u, i) => elegirUnidad(u, i, unidades, tarjetas, elegidas, { porSinonimo, sinSigno, deletreadas }));
    await cargarClips(elegidas);
    const validas = elegidas.filter((e) => clips[e.id]);
    const resumen = planificar(validas, segmentos);
    expresiones = construirExpresiones(unidades);
    return { ...resumen, signos: unidades.filter((u) => u.tipo === 'signo').length, porSinonimo, sinSigno, deletreadas };
  }


  // ----- Modo directo: signar lo que se oye mientras se oye -----
  //
  // El texto llega palabra a palabra desde el reconocedor de voz y no se conoce lo que vendrá, así que no hay
  // anticipo ni planificación por frases: cada palabra se signa en cuanto llega, detrás de la anterior. Si se
  // acumula retraso, se acelera un poco (hasta 1,35x) y se saltan las palabras de relleno. La cara marca la
  // frase cuando esta se cierra (pausa o resultado final del reconocedor).
  let directo = null;
  let lemas = {};
  const ESPERA_DIRECTO = 1.2;       // las manos esperan este tiempo al siguiente signo antes de bajar
  const PAUSA_FRASE = 1.4;          // un silencio así de largo cierra la frase
  const ESPERA_FRASE_COMPUESTA = 1.0; // una palabra que puede abrir una expresión ("por" de "por favor") espera tanto
  const OMITIR_DIRECTO = new Set(('EL LA LOS LAS LO UN UNA UNOS UNAS AL DEL A ANTE BAJO CABE DE DESDE EN ENTRE HACIA HASTA PARA POR SEGUN SIN SO SOBRE TRAS DURANTE MEDIANTE '
    + 'Y E O U NI QUE SI COMO PUES AUNQUE SINO PORQUE MAS ME SE NOS OS LE LES MI MIS SU SUS ES SON ERA ERAN FUE FUERON SOY ERES SOMOS SOIS SEA SEAN SIDO SIENDO '
    + 'HE HAS HA HEMOS HABEIS HAN HABIA HABIAN HABER HABIDO MUY TAN ASI').split(' '));
  const CIFRAS = 'cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve veinte'.split(' ');
  const numeroAPalabras = (n) => (n <= 20 ? [CIFRAS[n]] : n === 30 ? ['treinta'] : String(n).split('').map((c) => CIFRAS[+c]));
  const hayClave = (c) => propios[c] !== undefined || indice[c] !== undefined || compuestos[c] !== undefined;
  let prefijosFrase = null;
  function esPrefijoDeFrase(norm) {
    if (!prefijosFrase) {
      prefijosFrase = new Set();
      for (const clave of [...Object.keys(propios), ...Object.keys(indice), ...Object.keys(compuestos)]) {
        const w = clave.split(' ');
        for (let k = 1; k < w.length; k++) prefijosFrase.add(w.slice(0, k).join(' '));
      }
    }
    return prefijosFrase.has(norm);
  }

  async function cargarLemas() {
    try { const r = await fetch('/banco/lemas.json'); if (r.ok) lemas = await r.json(); } catch { /* sin lemas */ }
  }

  function directoIniciar() {
    directo = { t0: performance.now(), sinSigno: [], unidades: [], espera: null, cursor: 0, seg: 0, ultimaPalabra: -99, cola: Promise.resolve(), cerradas: 0, ultimo: null, fin: false };
    pista = []; expresiones = []; escalaTiempo = 1;
    return directo;
  }
  const ahoraDirecto = () => (directo ? (performance.now() - directo.t0) / 1000 : 0);
  function directoParar() { if (directo) { directoCerrarFrase(); directo.fin = true; } }
  const directoActivo = () => !!directo && !directo.fin;

  // Una palabra reconocida (ya estable).
  function directoPalabra(texto) {
    if (!directo) return;
    const ahora = ahoraDirecto();
    const limpio = texto.toLowerCase().replace(/[^0-9a-záéíóúüñ]+/g, '');
    if (!limpio) return;
    if (ahora - directo.ultimaPalabra > PAUSA_FRASE && directo.unidades.length > directo.cerradas) directoCerrarFrase();
    directo.ultimaPalabra = ahora;
    const esNumero = /^\d+$/.test(limpio);
    const partes = esNumero ? numeroAPalabras(parseInt(limpio, 10)) : [limpio];
    partes.forEach((p, k) => {
      const norm = normalizar(p);
      const lema = esNumero ? p : (lemas[p] || p);
      const letras = [...normalizar(p).toLowerCase()].filter((c) => letrasDef[c]);
      const u = {
        texto: esNumero ? p : texto.trim(), lema: normalizar(lema).toLowerCase(), tarjeta: '', seg: directo.seg,
        tipo: OMITIR_DIRECTO.has(norm) ? 'omitir' : 'deletreo', letras, t0: ahora + k * 0.3, t1: ahora + 0.45 + k * 0.3,
      };
      directoEncolar(u);
    });
  }

  function directoEncolar(u) {
    const d = directo;
    if (d.espera) {
      const previa = d.espera;
      d.espera = null;
      const unido = { ...previa, texto: previa.texto + ' ' + u.texto, t1: u.t1, lema: '', tarjeta: '', tipo: 'deletreo' };
      const clave = normalizar(unido.texto);
      if (hayClave(clave)) {
        if (esPrefijoDeFrase(clave)) { d.espera = unido; return; }
        return directoEmitir(unido);
      }
      if (esPrefijoDeFrase(clave)) { d.espera = unido; return; }
      directoEmitir(previa);
    }
    if (esPrefijoDeFrase(normalizar(u.texto))) { d.espera = u; return; }
    directoEmitir(u);
  }

  // Llamar en cada fotograma: suelta la palabra que esperaba una expresión que no llegó.
  function directoTick() {
    const d = directo;
    if (!d || !d.espera) return;
    if (ahoraDirecto() - d.espera.t0 > ESPERA_FRASE_COMPUESTA) { const u = d.espera; d.espera = null; directoEmitir(u); }
  }

  function directoEmitir(u) {
    const d = directo;
    u.idx = d.unidades.length;
    d.unidades.push(u);
    d.cola = d.cola.then(() => programarDirecto(u, u.idx)).catch(() => {});
  }

  async function programarDirecto(u, i) {
    const d = directo;
    if (!d) return;
    const elegidas = [];
    const informe = { porSinonimo: [], sinSigno: [], deletreadas: [] };
    elegirUnidad(u, i, d.unidades, {}, elegidas, informe);
    for (const p of informe.sinSigno) if (!d.sinSigno.includes(p)) d.sinSigno.push(p);
    if (d.sinSigno.length > 8) d.sinSigno.shift();
    await cargarClips(elegidas);
    // Una palabra que debía signarse y no tiene ningún clip se marca (sale en rojo en los subtítulos).
    if (u.tipo !== 'omitir' && !elegidas.some((e) => clips[e.id])) u.sinSigno = true;
    const ahora = ahoraDirecto();
    for (const e of elegidas) {
      const clip = clips[e.id];
      if (!clip) continue;
      const atraso = Math.max(d.cursor - ahora, 0);
      if (atraso > 3 && nivelDeCorte(e) >= 3) continue;                      // muy atrasado: se salta el relleno
      const vel = Math.min(1 + Math.max(atraso - 1, 0) / 6, 1.35);
      const desdeReposo = !d.ultimo || d.cursor < ahora - 0.6;
      const t = desdeReposo ? ahora + 0.4 : Math.max(ahora, d.cursor + enlace(d.ultimo.poses.at(-1), clip.poses[0]));
      const t1 = t + clip.dura / vel;
      const texto = e.u.texto.replace(/[¿?¡!.,;:"«»()]/g, '').trim();
      pista.push({ t0: t, t1, habla: Math.max(t1 - t, 0.3 + 0.07 * texto.replace(/[^\p{L}]/gu, '').length), idx: i, clip, texto });
      d.cursor = t1; d.ultimo = clip;
    }
    while (pista.length > 3 && pista[0].t1 < ahora - 20) pista.shift();      // no crece sin límite
    expresiones = construirExpresiones(d.unidades);
  }

  // Cierra la frase en curso: le pone puntuación (¿? si empieza por una palabra interrogativa) para que la cara la marque.
  function directoCerrarFrase() {
    const d = directo;
    if (!d) return;
    if (d.espera) { const u = d.espera; d.espera = null; directoEmitir(u); }
    const frase = d.unidades.slice(d.cerradas);
    if (!frase.length) return;
    d.cerradas = d.unidades.length;
    d.seg++;
    if (frase.some((u) => /[.!?]/.test(u.texto))) return;
    if (frase.some((u) => u.texto.includes('¿'))) { frase.at(-1).texto += '?'; d.cola = d.cola.then(() => { expresiones = construirExpresiones(d.unidades); }); return; }
    const primera = frase[0].texto.toLowerCase().replace(/[^a-záéíóúüñ ]/g, '');
    const pregunta = /^(qué|quién|quiénes|cuál|cuáles|dónde|cuándo|cómo|cuánto|cuánta|cuántos|cuántas|adónde|por qué)$/.test(primera);
    if (pregunta) { frase[0].texto = '¿' + frase[0].texto; frase.at(-1).texto += '?'; } else frase.at(-1).texto += '.';
    d.cola = d.cola.then(() => { expresiones = construirExpresiones(d.unidades); });
  }

  // Lo último que se ha dicho, para los subtítulos del modo directo.
  const directoPalabras = () => (directo ? directo.unidades.slice(-14).map((u) => ({ texto: u.texto.replace(/[¿?¡!.]/g, ''), sinSigno: !!u.sinSigno })) : []);
  const directoSinSigno = () => (directo ? directo.sinSigno.slice() : []);
  const directoTexto = () => (directo ? directo.unidades.slice(-14).map((u) => u.texto.replace(/[¿?¡!.]/g, '')).join(' ') : '');

  // ----- Planificación por frases (criterios de interpretación con habla rápida) -----
  //
  // En un vídeo grabado se conoce todo el audio de antemano, así que el avatar NO espera: cada signo
  // empieza a la vez que su palabra (un poco antes) y, si hay un silencio antes de la frase, la primera
  // seña se adelanta para ganar margen y mantener el ritmo. Se quitan muletillas y repeticiones y, si la
  // frase no cabe en su tiempo, se recorta lo prescindible ANTES que acelerar: la velocidad nunca pasa
  // de 1,2x. Si aun así no cabe, el avatar se retrasa y recupera en la siguiente pausa. Cifras, fechas,
  // nombres, negaciones y preguntas no se recortan nunca. (En directo sí haría falta un desfase de varios
  // segundos, porque no se sabe lo que viene.)
  const ANTICIPO_FRASE = 1.5;       // la primera seña de una frase puede empezar hasta tanto antes de su palabra
  const ANTICIPO_PALABRA = 0.4;     // cada seña empieza un poco antes de oírse su palabra
  const VELOCIDAD_MAXIMA = 1.2;
  const RETRASO_DE_APURO = 6;       // con más retraso que esto (s) entra el modo de apuro
  const VELOCIDAD_DE_APURO = 1.5;
  const MULETILLAS = new Set(['BUENO', 'PUES', 'ENTONCES', 'VALE', 'CLARO', 'MIRA', 'OYE', 'DIGAMOS']);
  const RETRASO_OBJETIVO = 6;       // retraso (s) que se intenta no superar; pasado esto se condensa más
  // Qué se sacrifica, de más a menos prescindible, cuando la frase no cabe en su tiempo:
  const RELLENO = new Set(['TAMBIEN', 'YA', 'PERO', 'CON', 'ALGO', 'CASI', 'ESTO', 'ENTONCES', 'ASI', 'AQUI', 'ALLI']);
  const APOYO = new Set(['SER', 'ESTAR', 'HAY', 'HACER', 'TENER', 'PODER', 'DEBER']);   // verbos de apoyo
  const MATICES = new Set(['MUY', 'MUCHO', 'MUCHA', 'MUCHOS', 'MUCHAS', 'POCO', 'BASTANTE', 'SIEMPRE', 'SOLO', 'MAS', 'MENOS', 'BIEN', 'CADA', 'TODO', 'TODOS']);
  const PREPOSICIONES = new Set(['A', 'AL', 'ANTE', 'BAJO', 'CON', 'CONTRA', 'DE', 'DEL', 'DESDE', 'DURANTE', 'EN', 'ENTRE', 'HACIA', 'HASTA', 'PARA', 'POR', 'SEGUN', 'SIN', 'SOBRE', 'TRAS']);
  // Intocables: nunca se recortan (preguntas, negaciones, cifras, saludos, calendario).
  const INTOCABLES = new Set([
    'QUE', 'QUIEN', 'QUIENES', 'COMO', 'CUANDO', 'DONDE', 'CUAL', 'CUALES', 'CUANTO', 'CUANTOS', 'CUANTA', 'CUANTAS', 'POR QUE',
    'NO', 'NUNCA', 'NADA', 'NADIE', 'TAMPOCO', 'NINGUN', 'NINGUNO', 'NINGUNA', 'SIN',
    'CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'VEINTE', 'TREINTA', 'CIEN', 'MIL',
    'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO', 'HOY', 'AYER', 'MANANA',
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
    'HOLA', 'ADIOS', 'GRACIAS', 'PERDON', 'POR FAVOR', 'BUENOS DIAS', 'BUENAS TARDES', 'BUENAS NOCHES',
  ]);
  const nivelDeCorte = (e) => {             // 0 = intocable; mayor = se sacrifica antes
    if (e.deletreo) return e.nombre ? 0 : 2;   // un nombre propio se deletrea siempre; el resto, si hay tiempo
    const p = normalizar(e.u.texto);
    if (INTOCABLES.has(p) || /^\d+$/.test(p)) return 0;
    if (RELLENO.has(p)) return 4;
    if (APOYO.has(p)) return 3;
    if (MATICES.has(p)) return 2;
    return e.complemento ? 1 : 0;           // lo demás es el núcleo (sujeto, verbo, objeto): se queda
  };

  function planificar(validas, segmentos) {
    const frases = new Map();
    for (const e of validas) {
      if (!frases.has(e.u.seg)) frases.set(e.u.seg, []);
      frases.get(e.u.seg).push(e);
    }
    const orden = [...frases.keys()].sort((a, b) => a - b);
    // Cuándo conviene empezar una frase: poco antes de su primera palabra con signo.
    const inicioIdeal = (seg) => Math.max(frases.get(seg)[0].u.t0 - ANTICIPO_FRASE, 0);
    const cuenta = { conMovimiento: 0, recortados: 0, frasesAceleradas: 0, frasesConApuro: 0, retrasoMaximo: 0, sumaRetraso: 0, nSignos: 0, adelantadas: 0 };
    let cursor = 0;

    orden.forEach((seg, n) => {
      // 1. Siempre fuera: muletillas al empezar la frase o seguidas de coma, y repeticiones seguidas.
      let lista = frases.get(seg).filter((e, k, todas) => {
        const palabra = normalizar(e.u.texto);
        const muletilla = MULETILLAS.has(palabra) && (k === 0 || /,\s*$/.test(e.u.texto)) && todas.length > 1;
        const repetida = k > 0 && todas[k - 1].id === e.id;
        return !muletilla && !repetida;
      });
      const inicio = Math.max(inicioIdeal(seg), cursor + TRANSICION);
      const disponible = (n + 1 < orden.length ? inicioIdeal(orden[n + 1]) : Infinity) - inicio;
      const necesario = (l, v) => l.reduce((s, e) => s + clips[e.id].dura / v + TRANSICION, 0);
      // Modo de apuro: si ya vamos muy por detrás del orador, se permite signar algo más deprisa
      // (y se recorta más) para volver a un retraso razonable. Mejor eso que perder el hilo.
      const apuro = inicio - frases.get(seg)[0].u.t0 > RETRASO_DE_APURO;
      const tope = apuro ? VELOCIDAD_DE_APURO : VELOCIDAD_MAXIMA;
      if (apuro) cuenta.frasesConApuro++;

      // 2. Si no cabe ni a la velocidad máxima, condensa por niveles (relleno, verbos de apoyo,
      //    matices, complementos), siempre de menos a más importante y desde el final. Matices y
      //    complementos solo se sacrifican cuando el retraso ya pasa del objetivo.
      const atrasado = inicio - frases.get(seg)[0].u.t0 > RETRASO_OBJETIVO;
      for (const nivel of atrasado ? [4, 3, 2, 1] : [4, 3]) {
        for (let k = lista.length - 1; k >= 0 && lista.length > 1 && necesario(lista, tope) > disponible; k--) {
          if (nivelDeCorte(lista[k]) === nivel) {
            // Una palabra deletreada se quita entera, nunca a medias.
            const g = lista[k].grupo;
            if (g === undefined) lista.splice(k, 1);
            else { for (let j = lista.length - 1; j >= 0; j--) if (lista[j].grupo === g) lista.splice(j, 1); k = Math.min(k, lista.length); }
          }
        }
      }
      cuenta.recortados += frases.get(seg).length - lista.length;

      // 3. Velocidad justa para caber, sin pasar nunca del tope.
      const velocidad = Math.min(Math.max(necesario(lista, 1) / disponible, 1), tope);
      if (velocidad > 1.01) cuenta.frasesAceleradas++;
      let t = inicio;
      lista.forEach(({ u, id }, k) => {
        if (k) t += enlace(clips[lista[k - 1].id].poses.at(-1), clips[id].poses[0]);
        // Si hay hueco, espera a su palabra (menos un pequeño anticipo): así sigue el ritmo del orador.
        t = Math.max(t, u.t0 - (k ? ANTICIPO_PALABRA : ANTICIPO_FRASE));
        const t1 = t + clips[id].dura / velocidad;
        pista.push({ t0: t, t1, habla: Math.max(t1 - t, 0.3 + 0.07 * u.texto.replace(/[^\p{L}]/gu, '').length), idx: u.idx, clip: clips[id], texto: u.texto.replace(/[¿?¡!.,;:"«»()]/g, '').trim() });
        cuenta.retrasoMaximo = Math.max(cuenta.retrasoMaximo, t - u.t0);
        cuenta.sumaRetraso += t - u.t0; cuenta.nSignos++; if (t <= u.t0) cuenta.adelantadas++;
        t = t1;
      });
      cursor = t;
      cuenta.conMovimiento += lista.length;
    });
    cuenta.retrasoMedio = cuenta.nSignos ? cuenta.sumaRetraso / cuenta.nSignos : 0;
    return cuenta;
  }

  // ----- Expresión de la cara, por frase y sincronizada con los signos -----
  //
  // La cara no es decoración de cada signo: marca la gramática de toda la oración. Una pregunta
  // sí/no lleva las cejas arriba de principio a fin; una pregunta con qué/quién/dónde, el ceño
  // fruncido; una negación, la cabeza que niega; "si" condicional, cejas arriba hasta la coma. Y las
  // palabras de emoción (feliz, triste, enfadado…) tiñen la cara mientras se signan. Los tiempos
  // salen de la pista ya planificada, así que la cara empieza con el primer signo de la frase
  // y termina con el último, aunque se hayan condensado palabras. (Reglas de la práctica
  // profesional pegadas por el usuario; la distinción cejas arriba/ceño en preguntas, sin validar.)
  const ENTRADA_EXPR = 0.28, SALIDA_EXPR = 0.35;
  const INTERROGATIVAS = /^(qué|quién|quiénes|cuál|cuáles|dónde|cuándo|cómo|cuánto|cuánta|cuántos|cuántas|adónde)$/;
  const NEGACIONES = new Set(['no', 'nunca', 'jamas', 'nada', 'nadie', 'tampoco', 'ninguno', 'ninguna', 'ni']);
  const EMOCIONES = {
    alegria: { escala: 1, palabras: ['feliz', 'felices', 'contento', 'contenta', 'alegre', 'alegria', 'encantado', 'encantada', 'genial', 'felicidades', 'cumpleanos', 'fiesta', 'amor', 'divertido', 'celebrar'] },
    alegria_suave: { expr: 'alegria', escala: 0.55, palabras: ['hola', 'gracias', 'bien', 'bueno', 'saludar', 'abrazar', 'invitar'] },
    tristeza: { escala: 1, palabras: ['triste', 'tristeza', 'lamento', 'pena', 'llorar', 'morir', 'muerte', 'fallecer', 'echar'] },
    enfado: { escala: 1, palabras: ['enfadado', 'enfadada', 'enfadar', 'rabia', 'odiar', 'furioso', 'furiosa', 'molesto'] },
    sorpresa: { escala: 1, palabras: ['sorpresa', 'sorprender', 'increible', 'guau'] },
    miedo: { escala: 1, palabras: ['miedo', 'asustar', 'susto', 'peligro', 'peligroso'] },
    dolor: { escala: 0.8, palabras: ['dolor', 'doler', 'enfermo', 'enferma', 'herida'] },
    duda: { escala: 1, palabras: ['quizas', 'dudar', 'duda', 'probablemente'] },
  };
  const EMOCION_DE = {};
  for (const [nombre, e] of Object.entries(EMOCIONES)) for (const p of e.palabras) EMOCION_DE[p] = { expr: e.expr || nombre, escala: e.escala, nombre: e.expr || nombre };
  const NOMBRE_EXPR = { alegria: 'alegría', tristeza: 'tristeza', enfado: 'enfado', sorpresa: 'sorpresa', miedo: 'miedo', dolor: 'dolor', duda: 'duda' };

  // Desviaciones (se suman a lo que ya haga el signo) de una expresión con nombre de signos.js.
  function deltasDeExpresion(nombre, escala = 1) {
    const e = Signos.EXPRESIONES[nombre] || {}, d = {};
    if (e.cejas) d[5] = e.cejas * escala;
    if (e.ceno) d[6] = e.ceno * escala;
    if (e.ojos !== undefined) d[7] = (e.ojos - 1) * escala;
    if (e.sonrisa) d[10] = e.sonrisa * escala;
    if (e.boca) d[11] = e.boca * escala;
    return d;
  }

  function construirExpresiones(unidades) {
    const lista = [];
    const limpia = (s) => s.replace(/[¿?¡!.,;:"«»()…]/g, '').trim();
    // Tiempo que ocupan en la pista las unidades desde..hasta (índices de unidad).
    const ventana = (desde, hasta) => {
      let t0 = Infinity, t1 = -Infinity;
      for (const e of pista) if (e.idx >= desde && e.idx <= hasta) { t0 = Math.min(t0, e.t0); t1 = Math.max(t1, e.t1); }
      return t1 > t0 ? [t0, t1] : null;
    };
    // Primera unidad con signo a partir de i (para que la marca caiga sobre algo que se signa).
    const conSigno = (i, hasta) => { for (let k = i; k <= hasta; k++) if (pista.some((e) => e.idx === k)) return k; return -1; };
    const poner = (desde, hasta, ev, minimo = 0) => {
      const w = ventana(desde, hasta);
      if (!w) return;
      if (w[1] - w[0] < minimo) w[1] = w[0] + minimo;
      lista.push({ t0: w[0], t1: w[1], ...ev });
    };

    let a = 0;
    for (let b = 0; b < unidades.length; b++) {
      const fin = /[.!?…]["»)]*\s*$/.test(unidades[b].texto) || b === unidades.length - 1;
      if (!fin) continue;
      const trozo = unidades.slice(a, b + 1);
      // Preguntas
      const iFin = trozo.findIndex((u) => u.texto.includes('?'));
      if (iFin >= 0) {
        let iIni = trozo.findIndex((u) => u.texto.includes('¿'));
        if (iIni < 0 || iIni > iFin) iIni = 0;
        const parte = trozo.slice(iIni, iFin + 1);
        const conPalabra = parte.some((u) => limpia(u.texto).toLowerCase().split(/\s+/).some((w) => INTERROGATIVAS.test(w)));
        poner(a + iIni, a + iFin, conPalabra
          ? { nombre: 'pregunta (qué, quién, dónde…): ceño', d: { 5: -0.15, 6: 0.85, 7: -0.12, 2: 0.0 }, nod: null, lado: 6 }
          : { nombre: 'pregunta sí/no: cejas arriba', d: { 5: 1, 7: 0.22, 1: 4, 3: -5 } });
      } else if (trozo.some((u) => u.texto.includes('!'))) {
        let iIni = trozo.findIndex((u) => u.texto.includes('¡'));
        if (iIni < 0) iIni = 0;
        poner(a + iIni, b, { nombre: 'exclamación', d: { 5: 0.55, 7: 0.25, 1: 4 } });
      }
      // Palabra a palabra: negación, sí, condicional y emoción.
      for (let i = a; i <= b; i++) {
        const u = unidades[i], crudo = limpia(u.texto).toLowerCase(), norm = normalizar(u.texto).toLowerCase(), lema = normalizar(u.lema || '').toLowerCase();
        if (NEGACIONES.has(norm) && conSigno(i, b) >= 0) {
          const k = conSigno(i, b);
          poner(k, Math.min(k + 1, b), { nombre: 'negación: cabeza', d: { 6: 0.4, 10: -0.2 }, shake: { amp: 16, f: 2.6 } }, 0.9);
        } else if (norm === 'si' && crudo === 'sí') {
          const k = conSigno(i, b);
          if (k >= 0) poner(k, k, { nombre: 'afirmación: asentir', d: { 10: 0.25 }, nod: { amp: 9, f: 2.4 } }, 0.8);
        } else if (crudo === 'si') {
          let h = i; while (h < b && !/[,;:]$/.test(unidades[h].texto)) h++;
          poner(i, h, { nombre: 'condición: cejas', d: { 5: 0.5, 2: 4 } });
        }
        const emo = EMOCION_DE[norm] || (lema && EMOCION_DE[lema]) || norm.split(/\s+/).map((w) => EMOCION_DE[w]).find(Boolean);
        if (emo && conSigno(i, i) >= 0) {
          poner(i, i, { nombre: NOMBRE_EXPR[emo.nombre] || emo.nombre, d: deltasDeExpresion(emo.expr, emo.escala) }, 0.7);
        }
      }
      a = b + 1;
    }
    return lista;
  }

  // Desviaciones de la cara en el instante t (reloj) y nombre de la expresión que domina.
  function superposicion(t) {
    const d = new Array(NM_N).fill(0);
    let nombre = '', mayor = 0;
    for (const ev of expresiones) {
      if (t < ev.t0 - ENTRADA_EXPR || t > ev.t1 + SALIDA_EXPR) continue;
      const w = t < ev.t0 ? suave((t - (ev.t0 - ENTRADA_EXPR)) / ENTRADA_EXPR)
        : t > ev.t1 ? suave(1 - (t - ev.t1) / SALIDA_EXPR) : 1;
      for (const k in ev.d) d[k] += ev.d[k] * w;
      if (ev.shake) d[4] += ev.shake.amp * w * Math.sin(2 * Math.PI * ev.shake.f * (t - ev.t0));
      if (ev.nod) d[3] += ev.nod.amp * w * Math.sin(2 * Math.PI * ev.nod.f * (t - ev.t0));
      if (ev.lado) d[2] += ev.lado * w;
      if (ev.nombre && w > mayor) { mayor = w; nombre = ev.nombre; }
    }
    return { d, nombre: mayor > 0.35 ? nombre : '' };
  }

  // Cuánto dura la articulación de la palabra de un signo: lo que tarda en decirse, sin pisar al siguiente.
  function bocaDe(actual, siguiente) {
    const tope = siguiente ? Math.max(siguiente.t0 + 0.15 - actual.t0, actual.t1 - actual.t0) : Infinity;
    return Math.min(actual.habla, tope);
  }

  // Pose y palabra en el instante t.
  function estadoEn(t) {
    let i = -1;
    for (let k = 0; k < pista.length && pista[k].t0 <= t; k++) i = k;
    const actual = pista[i], siguiente = pista[i + 1];
    if (actual && t <= actual.t1) {
      esPropio = !!actual.clip.propio;
      const k = (t - actual.t0) / (actual.t1 - actual.t0);
      return { pose: poseDeClip(actual.clip, k), texto: actual.texto, avance: Math.min((t - actual.t0) / bocaDe(actual, siguiente), 1), cara: caraDeClip(actual.clip, k) };
    }
    // En directo no se sabe si vendrá otra palabra: las manos esperan un momento donde están antes de bajar.
    if (directo && actual && !siguiente && t > actual.t1) {
      const ultimo = actual.clip.poses.at(-1), tras = t - actual.t1;
      const resto = tras < bocaDe(actual, null) ? { texto: actual.texto, avance: Math.min((t - actual.t0) / bocaDe(actual, null), 1) } : { texto: '', avance: 0 };
      if (tras < ESPERA_DIRECTO) return { pose: ultimo, ...resto };
      if (tras - ESPERA_DIRECTO < A_REPOSO) return { pose: mezclar(ultimo, REPOSO, suave((tras - ESPERA_DIRECTO) / A_REPOSO)), texto: '', avance: 0 };
      return { pose: REPOSO, texto: '', avance: 0 };
    }
    const desde = actual ? actual.clip.poses.at(-1) : REPOSO;
    const hasta = siguiente ? siguiente.clip.poses[0] : REPOSO;
    const inicio = actual ? actual.t1 : -Infinity, fin = siguiente ? siguiente.t0 : Infinity;
    // Si la palabra tarda más en decirse que el signo, los labios la terminan mientras las manos pasan al siguiente.
    const sigueHablando = actual && t - actual.t0 < bocaDe(actual, siguiente);
    const resto = sigueHablando ? { texto: actual.texto, avance: (t - actual.t0) / bocaDe(actual, siguiente) } : { texto: '', avance: 0 };
    if (fin - inicio <= PAUSA_LARGA) {                        // enlace directo de un signo al siguiente
      return { pose: mezclar(desde, hasta, suave((t - inicio) / (fin - inicio))), ...resto };
    }
    if (t - inicio < A_REPOSO) return { pose: mezclar(desde, REPOSO, suave((t - inicio) / A_REPOSO)), ...resto };
    if (fin - t < A_REPOSO) return { pose: mezclar(REPOSO, hasta, suave(1 - (fin - t) / A_REPOSO)), texto: '', avance: 0 };
    return { pose: REPOSO, texto: '', avance: 0 };
  }

  // ----- Boca: los sonidos reales de la palabra que se signa -----
  //
  // El intérprete articula la palabra mientras la signa (mouthing). Aquí se convierte la
  // palabra en sus sonidos con las reglas de la ortografía castellana y cada sonido se
  // dibuja con su forma de labios (visema). Las vocales duran más que las consonantes y se
  // interpola entre una forma y la siguiente (coarticulación), no se salta de una a otra.

  // Cada sonido se describe con: [ancho, abertura, redondeo, dientes de arriba, dientes de abajo, lengua visible,
  // posición de la lengua (0 baja, 1 contra los dientes de arriba, 2 entre los dientes), labios apretados, f]
  // (ancho y abertura en anchos de hombro; lo demás de 0 a 1). Son las pistas que usa quien lee los labios:
  // vocales abiertas/cerradas/redondeadas, bilabiales cerradas (b, p, m), labiodental (f), lengua en los dientes
  // (d, t, n, l), lengua entre los dientes (z, c+e/i, propio del castellano de España) y dientes juntos (s).
  const VISEMAS = {
    a: [0.2, 0.2, 0, 0.5, 0.25, 0.3, 0, 0, 0],
    e: [0.25, 0.11, 0, 0.8, 0.4, 0.25, 0, 0, 0],
    i: [0.28, 0.06, 0, 1, 0.8, 0.2, 0, 0, 0],
    o: [0.12, 0.15, 0.85, 0, 0, 0.2, 0, 0, 0],
    u: [0.08, 0.08, 1, 0, 0, 0.15, 0, 0, 0],
    cerrada: [0.16, 0, 0, 0, 0, 0, 0, 1, 0],            // b, p, m (y la v castellana, que suena como b)
    fv: [0.18, 0.04, 0, 1, 0, 0, 0, 0, 1],              // f: el labio de abajo toca los dientes de arriba
    lengua: [0.18, 0.08, 0, 0.9, 0.3, 1, 1, 0, 0],      // d, t, n, l: la punta de la lengua toca los dientes de arriba
    interdental: [0.2, 0.065, 0, 1, 0.6, 1, 2, 0, 0],   // z, c (e/i): la lengua asoma entre los dientes
    sibilante: [0.21, 0.04, 0, 1, 1, 0.1, 0, 0, 0],     // s, x: dientes casi juntos
    palatal: [0.16, 0.065, 0.35, 0.6, 0.4, 0.7, 1, 0, 0],   // ch, y, ll, ñ
    velar: [0.16, 0.1, 0, 0.3, 0, 0.6, 0, 0, 0],        // k, g, j, q: boca algo abierta, lengua atrás
    vibrante: [0.16, 0.075, 0, 0.6, 0.2, 0.8, 1, 0, 0], // r, rr
  };
  const VOCALES = 'aeiou';
  const PESO = { vocal: 2.3, consonante: 1, cerrada: 0.9 };

  function visemas(texto) {
    // Normaliza: minúsculas, sin tildes, conserva la ñ y la ü.
    const t = texto.toLowerCase().replace(/ñ/g, '\u0001').replace(/ü/g, 'u').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ').replace(/[^a-zñ]/g, '');
    const salida = [];
    const poner = (visema, tipo) => salida.push({ v: VISEMAS[visema], peso: PESO[tipo] });
    for (let i = 0; i < t.length; i++) {
      const c = t[i], sig = t[i + 1] || '', ant = t[i - 1] || '';
      if (VOCALES.includes(c)) { poner(c, 'vocal'); continue; }
      switch (c) {
        case 'h': break;                                                            // muda (ch se trata en la c)
        case 'b': case 'p': case 'm': case 'v': poner('cerrada', 'cerrada'); break;
        case 'f': poner('fv', 'consonante'); break;
        case 'd': case 't': case 'n': case 'l': poner('lengua', 'consonante'); break;
        case 'z': poner('interdental', 'consonante'); break;
        case 's': case 'x': poner('sibilante', 'consonante'); break;
        case 'c':
          if (sig === 'h') { poner('palatal', 'consonante'); i++; }                 // ch
          else if ('ei'.includes(sig)) poner('interdental', 'consonante');          // ce, ci
          else poner('velar', 'consonante');                                        // ca, co, cu
          break;
        case 'q': poner('velar', 'consonante'); if (sig === 'u') i++; break;        // que, qui: la u no suena
        case 'g':
          poner('velar', 'consonante');
          if (sig === 'u' && 'ei'.includes(t[i + 2] || '')) i++;                    // gue, gui: la u no suena
          break;
        case 'k': case 'j': poner('velar', 'consonante'); break;
        case 'y': case 'ñ': poner('palatal', 'consonante'); break;
        case 'r': poner('vibrante', 'consonante'); if (sig === 'r') i++; break;     // r, rr
        case 'w': poner('u', 'vocal'); break;
        default: poner('velar', 'consonante');
      }
      if (c === 'l' && sig === 'l') { salida.pop(); poner('palatal', 'consonante'); i++; }   // ll
    }
    return salida;
  }

  const memoVisemas = new Map();

  // Forma de la boca en el avance k (0..1) de la palabra: [ancho, alto, dientes] o null (reposo).
  function boca(texto, avance) {
    if (!memoVisemas.has(texto)) {
      const lista = visemas(texto);
      const total = lista.reduce((s, x) => s + x.peso, 0);
      let acumulado = 0;
      memoVisemas.set(texto, lista.map((x) => {            // centro de cada sonido, de 0 a 1
        const centro = (acumulado + x.peso / 2) / total;
        acumulado += x.peso;
        return { v: x.v, centro };
      }));
    }
    const lista = memoVisemas.get(texto);
    if (!lista.length) return null;
    // La boca se abre un poco antes de empezar la palabra y se relaja un poco después.
    const k = Math.min(Math.max(avance, 0), 1);
    const REPOSO_BOCA = [0.15, 0, 0, 0, 0, 0, 0, 0.5, 0];
    if (k < lista[0].centro) return mezclarBoca(REPOSO_BOCA, lista[0].v, suave(k / lista[0].centro));
    const ultimo = lista.at(-1);
    if (k >= ultimo.centro) return mezclarBoca(ultimo.v, REPOSO_BOCA, suave((k - ultimo.centro) / (1 - ultimo.centro + 1e-6)) * 0.7);
    let j = 0;
    while (lista[j + 1].centro < k) j++;
    const a = lista[j], b = lista[j + 1];
    return mezclarBoca(a.v, b.v, suave((k - a.centro) / (b.centro - a.centro)));
  }

  const mezclarBoca = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

  // La signante de los vídeos articula cada palabra mientras signa. De su cara (anchura de la boca, abertura interior,
  // sonrisa) sale la forma real; la lengua y la f vienen de los sonidos de la palabra, que la cámara no distingue.
  // Se mezcla con los sonidos (65 % grabada) para que la boca siga leyéndose con claridad.
  const acota = (x, a, b) => Math.min(Math.max(x, a), b);
  function formaConCara(fonemas, cara) {
    const [ancho, abre] = cara;
    const wn = acota((ancho - 0.42) / 0.28, 0, 1);
    const grabada = [
      0.09 + 0.19 * wn,                                           // anchura
      acota(abre * 0.85, 0, 0.26),                                // abertura
      acota((0.52 - ancho) / 0.1, 0, 1),                          // labios redondeados (boca estrecha)
      acota((abre - 0.03) / 0.08, 0, 1) * (0.55 + 0.45 * wn),     // dientes de arriba
      acota((abre - 0.12) / 0.12, 0, 1) * 0.7,                    // dientes de abajo
      fonemas[5], fonemas[6],                                     // lengua: de los sonidos
      abre < 0.025 ? 1 : 0,                                       // labios apretados
      fonemas[8],
    ];
    const peso = 0.65;
    return fonemas.map((v, i) => (i === 5 || i === 6 || i === 8 ? v : v + (grabada[i] - v) * peso));
  }

  // ----- Dibujo -----

  const DEDOS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  const PALMA = [0, 1, 5, 9, 13, 17];

  // Boca con labios de verdad: labio de arriba y de abajo (con grosor), comisuras, interior oscuro, dientes de arriba y
  // de abajo, y lengua. Todo sale de los números de cada sonido, así que se puede leer cada uno.
  const LABIO = '#d4d4d4', INTERIOR = '#2b2b2b', LENGUA_COLOR = '#bdbdbd';
  const AMPLIA_BOCA = 1.3;                                        // la boca se dibuja algo mayor que la real, para poder leerla

  function dibujarBoca(cx, by, u, f, sonrisa, grosor) {
    const [w, h, r, du, dd, tg, tp, aprieta, fv] = f;
    const mw = Math.max(w * AMPLIA_BOCA * u / 2 * (1 + 0.15 * sonrisa) , 0.03 * u);   // media anchura de la abertura
    const abre = h * AMPLIA_BOCA * u;                                                   // abertura total
    const lt = (0.017 + 0.026 * r) * u;                                                 // grosor de los labios (más al redondear)
    const yc = by - sonrisa * 0.03 * u;                                                 // las comisuras suben al sonreír
    const curva = (yMedio) => 2 * yMedio - yc;                                          // punto de control para pasar por yMedio
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = grosor * 1.2;
    if (abre < 0.014 * u) {
      // Labios cerrados (o casi): dos labios apoyados uno en otro. Apretados (b, p, m) se ven más gruesos y planos.
      const grosorLabio = lt * (aprieta > 0.3 ? 1.15 : 0.8);
      ctx.beginPath();
      ctx.moveTo(cx - mw - lt * 0.2, yc);
      ctx.quadraticCurveTo(cx, curva(by - grosorLabio * 1.2), cx + mw + lt * 0.2, yc);
      ctx.quadraticCurveTo(cx, curva(by + grosorLabio * 1.5), cx - mw - lt * 0.2, yc);
      ctx.fillStyle = LABIO; ctx.fill(); ctx.stroke();
      ctx.beginPath();                                                                  // la línea donde se juntan
      ctx.moveTo(cx - mw, yc); ctx.quadraticCurveTo(cx, curva(by + 0.002 * u), cx + mw, yc);
      ctx.lineWidth = grosor * 1.5; ctx.stroke();
      if (fv) {                                                                         // f: se asoman los dientes de arriba
        ctx.restore();
        return;
      }
      ctx.restore();
      return;
    }
    const arriba = by - abre * 0.38, abajo = by + abre * 0.62;                          // la mandíbula baja más que el labio de arriba
    // Contorno exterior de los labios y abertura interior
    ctx.beginPath();
    ctx.moveTo(cx - mw - lt * (0.6 + 0.6 * r), yc);
    ctx.quadraticCurveTo(cx, curva(arriba - lt * 1.35), cx + mw + lt * (0.6 + 0.6 * r), yc);
    ctx.quadraticCurveTo(cx, curva(abajo + lt * 1.55), cx - mw - lt * (0.6 + 0.6 * r), yc);
    ctx.fillStyle = LABIO; ctx.fill(); ctx.stroke();
    const interior = new Path2D();
    interior.moveTo(cx - mw, yc);
    interior.quadraticCurveTo(cx, curva(arriba), cx + mw, yc);
    interior.quadraticCurveTo(cx, curva(abajo), cx - mw, yc);
    ctx.fillStyle = INTERIOR; ctx.fill(interior);
    // Dentro de la boca: dientes y lengua
    ctx.save();
    ctx.clip(interior);
    ctx.lineWidth = Math.max(grosor * 0.45, 0.5);
    ctx.strokeStyle = '#9a9a9a';
    const diente = (x0, y0, ancho, alto) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(x0, y0, ancho, alto);
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(x0 + ancho * k / 5, y0); ctx.lineTo(x0 + ancho * k / 5, y0 + alto); ctx.stroke(); }
    };
    if (du > 0.05) diente(cx - mw, arriba - 1, mw * 2, Math.max(abre * (0.16 + 0.4 * du), 0.01 * u));
    if (dd > 0.05) { const alto = Math.max(abre * (0.12 + 0.3 * dd), 0.008 * u); diente(cx - mw, abajo - alto + 1, mw * 2, alto); }
    if (tg > 0.08) {
      const yL = tp === 0 ? abajo - abre * 0.24 : (tp < 1.5 ? arriba + abre * 0.48 : by + abre * 0.2);
      ctx.fillStyle = LENGUA_COLOR; ctx.strokeStyle = TINTA; ctx.lineWidth = Math.max(grosor * 0.5, 0.5);
      ctx.beginPath(); ctx.ellipse(cx, yL, mw * (tp >= 1.5 ? 0.6 : 0.5), Math.max(abre * 0.2 * Math.min(tg + 0.2, 1), 0.006 * u), 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    if (fv) {                                                                           // f: el labio de abajo sube sobre los dientes
      ctx.fillStyle = LABIO;
      ctx.fillRect(cx - mw, arriba + abre * 0.5, mw * 2, abre * 2);
    }
    ctx.restore();
    ctx.lineWidth = grosor * 1.2; ctx.strokeStyle = TINTA;
    ctx.stroke(interior);
    ctx.restore();
  }

  // opciones: pregunta (cejas arriba) y zoom (1 = hasta las caderas, con las manos en reposo a la vista; más = más cerca)
  function pintar(t, { pregunta = false, rotular = false, zoom = 1, margen = null, pose: poseDada = null, texto: textoDado = '', avance: avanceDado = 0 } = {}) {
    t *= escalaTiempo;
    const { pose: p, texto, avance, cara = null } = poseDada ? { pose: poseDada, texto: textoDado, avance: avanceDado } : estadoEn(t);
    const propia = poseDada ? true : esPropio;
    const W = lienzo.width, H = lienzo.height;
    const u = W * 0.245 * zoom, ox = W / 2;                      // unidad = ancho de hombros
    const oy = (margen === null ? H * 0.1 / zoom : margen) + 1.3 * u;                        // la cabeza siempre queda arriba, a la vista
    const X = (i) => ox + p[i] * u, Y = (i) => oy + p[i + 1] * u;
    const grosor = Math.max(2, W / 260) * Math.sqrt(zoom);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = TINTA;
    ctx.fillStyle = PAPEL;
    ctx.lineWidth = grosor;

    // Gestos no manuales de este instante (inclinación, cabeza, cejas, ojos, mirada, boca).
    const nm = (p.length > NM ? p.slice(NM, NM + NM_N) : NM_NEUTRO).slice();
    const capa = superposicion(t);
    for (let k = 0; k < NM_N; k++) nm[k] += capa.d[k];
    if (cara) nm[5] += acota((cara[6] - 0.23) / 0.06, -1, 1) * 0.5;   // cejas de la signante, suavizadas
    nm[5] = Math.max(-1, Math.min(1.2, nm[5])); nm[6] = Math.max(-1, Math.min(1.1, nm[6]));
    nm[7] = Math.max(0, Math.min(1.4, nm[7])); nm[10] = Math.max(-1, Math.min(1, nm[10])); nm[11] = Math.max(0, Math.min(1, nm[11]));
    const RAD = Math.PI / 180;

    // Inclinación del cuerpo: todo el personaje gira alrededor de la cintura (y se acerca un poco al inclinarse adelante).
    ctx.save();
    const pivoteX = ox, pivoteY = oy + 1.7 * u;
    ctx.translate(pivoteX, pivoteY + nm[1] * 0.004 * u);
    ctx.rotate(nm[0] * RAD);
    const acerca = 1 + nm[1] * 0.0035;
    ctx.scale(acerca, acerca);
    ctx.translate(-pivoteX, -pivoteY);

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
    const cuelloY = (hiy + hdy) / 2 - 0.08 * u;
    ctx.beginPath();                                            // cuello
    ctx.moveTo(cx - 0.13 * u, cy + r * 0.8); ctx.lineTo(cx - 0.13 * u, cuelloY);
    ctx.moveTo(cx + 0.13 * u, cy + r * 0.8); ctx.lineTo(cx + 0.13 * u, cuelloY);
    ctx.stroke();

    ctx.save();                                                 // la cabeza se inclina sobre el cuello
    ctx.translate(cx, cuelloY); ctx.rotate(nm[2] * RAD); ctx.translate(-cx, -cuelloY);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();                                            // flequillo, como el personaje de las tarjetas
    for (let k = -3; k <= 3; k++) {
      ctx.moveTo(cx + k * 0.035 * u, cy - r);
      ctx.quadraticCurveTo(cx + k * 0.1 * u, cy - r * 0.8, cx + k * 0.115 * u, cy - r * (0.52 - Math.abs(k) * 0.03));
    }
    ctx.stroke();
    // Girar y asentir desplazan los rasgos dentro de la cabeza.
    ctx.translate(nm[4] * 0.0042 * u, nm[3] * 0.0035 * u);

    // Ojos y cejas
    const parpadeo = (t % 4.3) < 0.12;
    const abierto = parpadeo ? 0 : nm[7];
    const alza = nm[5] * 0.11 * u;   // cejas levantadas (+) o bajas (-)
    for (const lado of [-1, 1]) {
      const ex = cx + lado * 0.17 * u, ey = cy - 0.02 * u;
      ctx.beginPath();
      if (abierto < 0.15) {                                       // cerrados
        ctx.moveTo(ex - 0.045 * u, ey); ctx.quadraticCurveTo(ex, ey + 0.022 * u, ex + 0.045 * u, ey); ctx.stroke();
      } else {
        const rx = 0.03 * u * (abierto > 1 ? 1 + (abierto - 1) * 1.2 : 1);
        const ry = Math.max(rx * Math.min(abierto, 1.35), 0.006 * u);   // entornados = más achatados
        ctx.ellipse(ex + nm[8] * 0.03 * u, ey - nm[9] * 0.025 * u, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = TINTA; ctx.fill(); ctx.fillStyle = PAPEL;
      }
      const baseY = ey - 0.13 * u - alza;
      const ceño = nm[6] * 0.085 * u;                              // + interior abajo (enfado), - interior arriba (tristeza)
      const interior = [ex - lado * 0.07 * u, baseY + ceño];
      const exterior = [ex + lado * 0.07 * u, baseY + 0.01 * u - ceño * 0.4];
      ctx.beginPath();
      ctx.moveTo(interior[0], interior[1]);
      ctx.quadraticCurveTo(ex, (interior[1] + exterior[1]) / 2 - 0.035 * u, exterior[0], exterior[1]);
      ctx.stroke();
    }

    // Boca: articula la palabra que se signa; sin palabra, muestra la expresión.
    const forma = texto ? (cara ? formaConCara(boca(texto, avance), cara) : boca(texto, avance)) : null, by = cy + 0.22 * u;
    const sonrisa = acota(nm[10] + (cara ? acota(cara[3] / 0.05, -1, 1) * 0.5 : 0), -1, 1);
    ctx.beginPath();
    if (!forma && nm[11] > 0.15) {                                // boca abierta (sorpresa, miedo)
      ctx.ellipse(cx, by, (0.05 + 0.03 * nm[11]) * u, (0.03 + 0.07 * nm[11]) * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (!forma) {
      const comisura = by - (0.01 + 0.012 * sonrisa) * u, curva = by + (0.03 + 0.06 * sonrisa) * u, ancho = (0.09 + 0.02 * sonrisa) * u;
      ctx.moveTo(cx - ancho, comisura); ctx.quadraticCurveTo(cx, curva, cx + ancho, comisura); ctx.stroke();
    } else {
      dibujarBoca(cx, by, u, forma, sonrisa, grosor);
    }
    if (nm[12] > 0.3) {                                           // mejillas infladas
      for (const lado of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + lado * 0.27 * u, by - 0.02 * u, 0.075 * u * nm[12], 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();                                                // fin de la cabeza

    // Brazos y manos, encima de todo. Cada pieza es un "tubo": trazo negro y, por dentro, blanco.
    const borde = grosor * 0.8;
    const tubo = (puntos, ancho, cerrado = false, tinta = TINTA) => {
      for (const [color, w] of [[tinta, ancho + borde * 2], [PAPEL, ancho]]) {
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.fillStyle = color;
        ctx.beginPath();
        puntos.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (cerrado) { ctx.closePath(); ctx.fill(); }
        ctx.stroke();
      }
    };
    // Tubo que cambia de grosor (el antebrazo se ensancha al acercarse a quien mira).
    const cono = (a, b, w0, w1, tinta = TINTA) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], largo = Math.hypot(dx, dy) || 1, nx = -dy / largo, ny = dx / largo;
      for (const [color, extra] of [[tinta, borde * 2], [PAPEL, 0]]) {
        const r0 = (w0 + extra) / 2, r1 = (w1 + extra) / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(a[0] + nx * r0, a[1] + ny * r0); ctx.lineTo(b[0] + nx * r1, b[1] + ny * r1);
        ctx.lineTo(b[0] - nx * r1, b[1] - ny * r1); ctx.lineTo(a[0] - nx * r0, a[1] - ny * r0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(a[0], a[1], r0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b[0], b[1], r1, 0, Math.PI * 2); ctx.fill();
      }
    };
    // ---- Profundidad de cada brazo ----
    // La profundidad grabada de la muñeca es muy ruidosa, así que se deduce de la longitud: un hueso mide siempre lo
    // mismo, y si en el dibujo se ve más corto es porque apunta hacia quien mira (escorzo). Solo falta decidir el sentido,
    // y al signar las manos van delante del cuerpo. Sale 0 = pegada al cuerpo ... 1 = muy adelantada.
    const L_SUPERIOR = 1.0, L_ANTEBRAZO = 0.95;
    const profundidad = (hombro, codo, mano) => {
      const lS = Math.hypot(p[codo] - p[hombro], p[codo + 1] - p[hombro + 1]);
      const lA = Math.hypot(p[mano] - p[codo], p[mano + 1] - p[codo + 1]);
      const dzS = Math.sqrt(Math.max(L_SUPERIOR * L_SUPERIOR - lS * lS, 0)), dzA = Math.sqrt(Math.max(L_ANTEBRAZO * L_ANTEBRAZO - lA * lA, 0));
      return { mano: Math.min(Math.max((dzS + dzA - 0.25) / 1.25, 0), 1), codo: Math.min(dzS / 0.8, 1) };
    };
    const gris = (prof) => { const g = Math.round(150 * (1 - Math.min(prof * 1.7, 1))); return `rgb(${g},${g},${g})`; };   // lejos = gris, cerca = negro
    // ---- Mano como un guante blanco ----
    // Una sola silueta continua: primero se pinta la unión de palma, dedos y pulgar con un contorno exterior firme
    // (así no hay rayas entre la palma y los dedos), y por dentro solo se marcan, con línea fina, los dedos que pasan por
    // delante de otros. Después, un sombreado muy suave. Se dibuja en una capa aparte para sombrear solo la mano.
    const manoContinua = (pts, anchoPalma, anchoDedo, tinta, zDedo, muneca) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const margen = 0.26 * u;
      x0 = Math.floor(x0 - margen); y0 = Math.floor(y0 - margen);
      const sw = Math.ceil(x1 + margen - x0), sh = Math.ceil(y1 + margen - y0);
      if (!CAPA_MANO) CAPA_MANO = document.createElement('canvas');
      if (CAPA_MANO.width < sw) CAPA_MANO.width = sw;
      if (CAPA_MANO.height < sh) CAPA_MANO.height = sh;
      const g = CAPA_MANO.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, CAPA_MANO.width, CAPA_MANO.height);
      g.setTransform(1, 0, 0, 1, -x0, -y0);
      g.lineJoin = 'round'; g.lineCap = 'round';
      const trazo = grosor * 1.5, fino = Math.max(grosor * 0.55, 0.8);
      const ancho = (k) => anchoDedo * (k ? 0.062 : 0.074);
      // Palma: curva cerrada y suave por la muñeca ancha, el pulgar y los nudillos.
      const nud = [pts[5], pts[9], pts[13], pts[17]];
      const lateral = [(pts[17][0] - pts[5][0]) * 0.42, (pts[17][1] - pts[5][1]) * 0.42];
      const crudo = [[pts[0][0] - lateral[0], pts[0][1] - lateral[1]], [pts[0][0] + lateral[0], pts[0][1] + lateral[1]], pts[1], ...nud];
      const c0 = [crudo.reduce((a, q) => a + q[0], 0) / crudo.length, crudo.reduce((a, q) => a + q[1], 0) / crudo.length];
      const base = crudo.slice().sort((a, b) => Math.atan2(a[1] - c0[1], a[0] - c0[0]) - Math.atan2(b[1] - c0[1], b[0] - c0[0]));
      const inflados = base.map(([x, y]) => { const dx = x - c0[0], dy = y - c0[1], d = Math.hypot(dx, dy) || 1; return [x + dx / d * anchoPalma * 0.7, y + dy / d * anchoPalma * 0.7]; });
      const rutaPalma = new Path2D();
      const medio = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const m0 = medio(inflados.at(-1), inflados[0]);
      rutaPalma.moveTo(m0[0], m0[1]);
      inflados.forEach((q, i) => { const m = medio(q, inflados[(i + 1) % inflados.length]); rutaPalma.quadraticCurveTo(q[0], q[1], m[0], m[1]); });
      rutaPalma.closePath();
      const dedos = DEDOS.map((d, k) => ({ k, f: d.map((i) => pts[i]), w: ancho(k), z: zDedo(k) }));
      const trazarDedo = (e, desde = 0) => { g.beginPath(); e.f.slice(desde).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
      // Manga: un trozo de antebrazo para que la muñeca no tenga corte.
      const manga = muneca ? [[muneca[0][0] * 0 + muneca[1][0], muneca[1][1]], pts[0]] : null;
      const wManga = anchoPalma * 2.1;

      // 1. Contorno exterior de la unión
      g.strokeStyle = tinta; g.fillStyle = tinta;
      g.lineWidth = trazo * 2; g.stroke(rutaPalma); g.fill(rutaPalma);
      for (const e of dedos) { g.lineWidth = e.w + trazo * 2; trazarDedo(e); }
      if (manga) { g.lineWidth = wManga + trazo * 2; g.beginPath(); g.moveTo(manga[0][0], manga[0][1]); g.lineTo(manga[1][0], manga[1][1]); g.stroke(); }
      // 2. Relleno blanco de la unión
      g.strokeStyle = '#fff'; g.fillStyle = '#fff';
      g.fill(rutaPalma);
      for (const e of dedos) { g.lineWidth = e.w; trazarDedo(e); }
      if (manga) { g.lineWidth = wManga; g.beginPath(); g.moveTo(manga[0][0], manga[0][1]); g.lineTo(manga[1][0], manga[1][1]); g.stroke(); }
      // 3. Líneas finas interiores: de lejos a cerca, cada pieza tapa a las que tiene detrás y deja su borde.
      const piezasOrden = [{ tipo: 'palma', z: z0Palma(zDedo) }, ...dedos.map((e) => ({ tipo: 'dedo', e, z: e.z }))].sort((p, q) => q.z - p.z);
      for (const it of piezasOrden) {
        if (it.tipo === 'palma') { g.fillStyle = '#fff'; g.fill(rutaPalma); continue; }
        const e = it.e;
        g.strokeStyle = tinta; g.lineCap = 'butt'; g.lineWidth = e.w + fino * 2; trazarDedo(e, 1);        // sin la primera falange: nace de la palma
        g.fillStyle = tinta; g.beginPath(); g.arc(e.f.at(-1)[0], e.f.at(-1)[1], e.w / 2 + fino, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineWidth = e.w; trazarDedo(e);
      }
      // 4. Sombreado suave (la luz viene de arriba a la izquierda), solo sobre lo pintado de la mano.
      g.globalCompositeOperation = 'source-atop';
      const gr = g.createLinearGradient(x0 + sw * 0.15, y0 + sh * 0.1, x0 + sw * 0.9, y0 + sh * 0.95);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.16)');
      g.fillStyle = gr; g.fillRect(x0, y0, sw, sh);
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(CAPA_MANO, 0, 0, sw, sh, x0, y0, sw, sh);
    };
    const z0Palma = (zDedo) => (zDedo(1) + zDedo(2) + zDedo(3) + zDedo(4)) / 4 + 0.01;   // la palma queda algo detrás de los dedos
    // Piezas de un brazo, cada una con su profundidad media (z menor = más cerca).
    const piezas = (hombro, codo, mano, zMano, zMuneca) => {
      const prof = profundidad(hombro, codo, mano), tinta = gris(prof.mano);
      const escala = 0.88 + 0.34 * prof.mano;                   // perspectiva: más cerca, más grande
      const mx = X(mano), my = Y(mano);
      const M = (k) => [mx + (X(mano + k * 2) - mx) * escala, my + (Y(mano + k * 2) - my) * escala];
      const z = (lista) => lista.reduce((s, k) => s + p[zMano + k], 0) / lista.length;
      const anchoPalma = (propia ? 0.085 : 0.075) * u * escala, anchoDedo = (propia ? 1.45 : 1.25) * u * escala;
      const lista = [
        { z: Infinity, pinta: () => {
          tubo([[X(hombro), Y(hombro)], [X(codo), Y(codo)]], 0.16 * u * (0.95 + 0.12 * prof.codo), false, tinta);
          cono([X(codo), Y(codo)], M(0), 0.16 * u * (0.9 + 0.14 * prof.codo), 0.16 * u * (0.82 + 0.5 * prof.mano), tinta);
        } },
        { z: 0, pinta: () => manoContinua(Array.from({ length: 21 }, (_, k) => M(k)), anchoPalma, anchoDedo, tinta, (k) => z(DEDOS[k]), [[X(codo), Y(codo)], [X(codo) + (M(0)[0] - X(codo)) * 0.72, Y(codo) + (M(0)[1] - Y(codo)) * 0.72]]) },
      ];
      const centro = [0, 5, 9, 13, 17].map(M).reduce((a, q) => [a[0] + q[0] / 5, a[1] + q[1] / 5], [0, 0]);
      return { fondo: -prof.mano, prof: prof.mano, centro, escala, codo: [X(codo), Y(codo)], muneca: M(0), piezas: lista.sort((a, b) => b.z - a.z) };   // de lejos a cerca
    };
    const brazos = [piezas(4, 8, DER, Z_DER, Z_MUNECAS + 1), piezas(2, 6, IZQ, Z_IZQ, Z_MUNECAS)];
    brazos.sort((a, b) => b.fondo - a.fondo);                   // primero el brazo que queda detrás (el menos adelantado)
    // Sombra sobre el cuerpo y la cara: cuanto más adelantada y más lejos del cuerpo, más separada y más tenue.
    const sombra = (clip) => {
      ctx.save(); ctx.clip(clip);
      for (const b of brazos) {
        if (b.prof < 0.3) continue;
        const sepa = 0.04 + 0.12 * b.prof, alfa = 0.1 + 0.1 * b.prof;
        ctx.fillStyle = `rgba(0,0,0,${alfa})`; ctx.strokeStyle = `rgba(0,0,0,${alfa * 0.8})`;
        ctx.lineCap = 'round'; ctx.lineWidth = 0.13 * u * b.escala;
        ctx.beginPath(); ctx.moveTo(b.codo[0] + sepa * u * 0.6, b.codo[1] + sepa * u); ctx.lineTo(b.muneca[0] + sepa * u * 0.6, b.muneca[1] + sepa * u); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(b.centro[0] + sepa * u * 0.6, b.centro[1] + sepa * u, 0.13 * u * b.escala, 0.15 * u * b.escala, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    };
    const torso = new Path2D();
    torso.moveTo(hdx - 0.06 * u, H + 10); torso.lineTo(hdx - 0.02 * u, hdy + 0.12 * u);
    torso.quadraticCurveTo(hdx, hdy - 0.06 * u, hdx + 0.2 * u, hdy - 0.1 * u); torso.lineTo(hix - 0.2 * u, hiy - 0.1 * u);
    torso.quadraticCurveTo(hix, hiy - 0.06 * u, hix + 0.02 * u, hiy + 0.12 * u); torso.lineTo(hix + 0.06 * u, H + 10); torso.closePath();
    const cabeza = new Path2D(); cabeza.arc(cx, cy, r, 0, Math.PI * 2);
    sombra(torso); sombra(cabeza);
    for (const brazo of brazos) for (const pieza of brazo.piezas) pieza.pinta();
    ctx.restore();                                              // fin de la inclinación del cuerpo
    ctx.strokeStyle = TINTA; ctx.lineWidth = grosor; ctx.fillStyle = PAPEL;
    if (rotular && capa.nombre) {                                 // rótulo de la expresión que se marca
      ctx.save();
      ctx.font = `700 ${Math.round(W * 0.052)}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = TINTA; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(capa.nombre, W * 0.04, H * 0.035, W * 0.92);
      ctx.restore();
    }
    return texto;
  }

  return { iniciar, preparar, pintar, visemas, boca, pista: () => pista, propio: crearPropio, letra: crearLetra, definiciones: () => definiciones, compuestos: () => compuestos, sinonimos: () => sinonimos, directoIniciar, directoPalabra, directoCerrarFrase, directoParar, directoTick, directoActivo, directoTexto, directoPalabras, directoSinSigno, ahoraDirecto, expresiones: () => expresiones, gestos: () => gestosPalabra };
})();
