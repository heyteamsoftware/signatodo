// Modo directo: el avatar signa a pantalla completa lo que se oye por el micrófono.
//
// El reconocimiento de voz lo hace el sistema: en la app de Android, el reconocedor del teléfono a través del puente
// `AndroidVoz`; en un navegador de escritorio, la API Web Speech si existe; si no, un cuadro para escribir frases de
// prueba. Cada palabra se da al avatar cuando ya es estable (todas menos la última de la hipótesis en curso).

const $ = (id) => document.getElementById(id);
const lienzo = $('avatar');
let zoom = 1, margen = 0.1;
let escuchando = false;
let comprometidas = 0;          // palabras de la hipótesis actual que ya se han dado al avatar
let tentativo = '';             // última palabra aún no estable
let reconocedorWeb = null;
let motorListo = false;
let tresD = localStorage.getItem('signatodo-3d') !== 'no';   // muñeco 3D salvo que se haya elegido el plano

function ajustar() {
  // Cuadro de 600x560 (como el recuadro de la web). Es todo lo ancho que cabe, sin pasarse de alto.
  const ancho = Math.max(Math.min(window.innerWidth - 24, (window.innerHeight * 0.44) * 600 / 560, 760), 200);
  const alto = ancho * 560 / 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  lienzo.style.width = ancho + 'px';
  lienzo.style.height = alto + 'px';
  lienzo.width = Math.round(ancho * dpr);
  lienzo.height = Math.round(alto * dpr);
  zoom = 1; margen = null;
}

function estado(texto) { $('estado').textContent = texto; }

// ---------- Voz -> palabras ----------

let ultimoOido = '';
let parcialPendiente = '';      // última hipótesis sin cerrar, por si el reconocedor se corta sin dar el resultado final
let finalesWeb = 0;             // resultados finales ya tratados de la sesión de Web Speech en curso

// texto: hipótesis en curso (o resultado final) de lo que se está diciendo.
// arrastrar: las palabras ya dadas que sobran al cerrar pertenecen a lo siguiente (Web Speech parte la hipótesis en trozos).
function procesar(texto, final, arrastrar = false) {
  ultimoOido = texto.trim();
  const palabras = ultimoOido.split(/\s+/).filter(Boolean);
  const hasta = final ? palabras.length : Math.max(palabras.length - 1, 0);
  for (let i = comprometidas; i < hasta; i++) Avatar.directoPalabra(palabras[i]);
  const sobrantes = final && arrastrar ? Math.max(comprometidas - palabras.length, 0) : 0;
  comprometidas = Math.max(comprometidas, hasta);      // nunca retrocede: si la hipótesis se acorta un instante, no se repiten palabras
  tentativo = final ? '' : (palabras[palabras.length - 1] || '');
  parcialPendiente = final ? '' : ultimoOido;
  if (final) { Avatar.directoCerrarFrase(); comprometidas = sobrantes; }
}
// El reconocedor se ha cortado (error o silencio) sin dar resultado final: se da por buena la última hipótesis.
function corte() {
  if (parcialPendiente) procesar(parcialPendiente, true); else comprometidas = 0;
}
window.vozParcial = (texto) => { if (escuchando) procesar(texto, false); };
window.vozFinal = (texto) => { if (escuchando) procesar(texto, true); };
window.vozCorte = () => { if (escuchando) corte(); };
window.vozEstado = (texto) => estado(texto);
window.vozError = (mensaje) => {
  if (/permiso|no disponible/i.test(mensaje)) falloDeVoz(mensaje + '. Puedes escribir la frase.');
  else estado(mensaje);
};

// El micrófono o el servicio de voz no funcionan: se para y se ofrece escribir, en vez de quedarse sin hacer nada.
function falloDeVoz(mensaje) {
  parar();
  estado(mensaje);
  $('escribir').hidden = false;
}

const FALLOS_WEB = {
  'not-allowed': 'Este navegador no deja usar el micrófono. Escribe la frase abajo.',
  'service-not-allowed': 'Este navegador no deja usar el reconocimiento de voz. Escribe la frase abajo.',
  'audio-capture': 'No se encuentra ningún micrófono. Escribe la frase abajo.',
  network: 'El servicio de voz del navegador no responde. Escribe la frase abajo.',
  'language-not-supported': 'El navegador no reconoce voz en español. Escribe la frase abajo.',
};

function empezar() {
  Avatar.directoIniciar();
  comprometidas = 0; tentativo = ''; parcialPendiente = ''; ultimoOido = '';
  escuchando = true;
  $('grabar').setAttribute('aria-pressed', 'true');
  $('grabar-texto').textContent = 'Parar';
  if (window.AndroidVoz) {
    estado('Escuchando…');
    window.AndroidVoz.iniciar();
  } else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Reconocedor();
    reconocedorWeb = r;
    r.lang = 'es-ES'; r.continuous = true; r.interimResults = true;
    r.onstart = () => { finalesWeb = 0; estado('Escuchando…'); };
    r.onresult = (e) => {
      // Los resultados finales van primero; lo que queda sin cerrar puede venir en varios trozos, que se unen.
      let interino = '';
      for (let i = finalesWeb; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { procesar(t, true, true); finalesWeb = i + 1; } else interino += ' ' + t;
      }
      if (interino.trim()) procesar(interino, false);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;            // silencio: se sigue escuchando
      falloDeVoz(FALLOS_WEB[e.error] || `Fallo del reconocimiento de voz (${e.error}). Escribe la frase abajo.`);
    };
    r.onend = () => {
      if (!escuchando || reconocedorWeb !== r) return;
      corte();
      try { r.start(); } catch { /* ya en marcha */ }
    };
    estado('Pidiendo el micrófono…');
    try { r.start(); } catch (error) { falloDeVoz('No se ha podido abrir el micrófono. Escribe la frase abajo.'); }
  } else {
    escuchando = false;
    $('grabar').setAttribute('aria-pressed', 'false');
    $('grabar-texto').textContent = 'Grabar';
    estado('Este navegador no reconoce voz. Escribe la frase abajo.');
    $('escribir').hidden = false;
  }
}

function parar() {
  if (!escuchando) return;
  corte();                       // lo último que se estaba diciendo no se pierde al parar
  escuchando = false;
  tentativo = '';
  $('grabar').setAttribute('aria-pressed', 'false');
  $('grabar-texto').textContent = 'Grabar';
  if (window.AndroidVoz) window.AndroidVoz.detener();
  if (reconocedorWeb) { try { reconocedorWeb.stop(); } catch { /* nada */ } reconocedorWeb = null; }
  Avatar.directoParar();
  estado('Listo');
}

// Escribir una frase de prueba: sale palabra a palabra, como si se estuviera hablando.
$('escribir').addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = $('texto-prueba').value.trim();
  if (!texto) return;
  $('texto-prueba').value = '';
  if (!Avatar.directoActivo()) Avatar.directoIniciar();     // no toca el botón Grabar: escribir y grabar son independientes
  ultimoOido = texto;
  const palabras = texto.split(/\s+/);
  palabras.forEach((p, i) => setTimeout(() => {
    Avatar.directoPalabra(p);
    if (i === palabras.length - 1) Avatar.directoCerrarFrase();
  }, i * 420));
});

// ---------- Pantalla ----------

function subtitulos() {
  const base = Avatar.directoPalabras().map((p) => `<span class="${p.sinSigno ? 'sin' : ''}">${escaparHtml(p.texto)}</span>`).join(' ');
  const caja = $('subtitulos');
  const html = base + (tentativo ? ` <span class="tentativo">${escaparHtml(tentativo)}</span>` : '');
  if (caja.dataset.html !== html) { caja.innerHTML = html; caja.dataset.html = html; }
}
const escaparHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function oido() {
  const falta = Avatar.directoSinSigno();
  const html = (ultimoOido ? `Oído: ${escaparHtml(ultimoOido)}` : '') + (falta.length ? `<br><span class="falta">Sin signo: ${escaparHtml(falta.join(', '))}</span>` : '');
  const caja = $('oido');
  if (caja.dataset.html !== html) { caja.innerHTML = html; caja.dataset.html = html; }
}

let falloDibujo = false;
function bucle() {
  // Un fallo al dibujar un fotograma no debe dejar el avatar parado para siempre: se avisa y se sigue.
  try {
    Avatar.directoTick();
    const palabra = Avatar.pintar(Avatar.ahoraDirecto(), { zoom, margen, tresD, rotular: false }) || '';
    if ($('rotulo').dataset.p !== palabra) { $('rotulo').textContent = palabra || ' '; $('rotulo').dataset.p = palabra; }
    subtitulos();
    oido();
  } catch (error) {
    if (!falloDibujo) { falloDibujo = true; estado('Error al dibujar: ' + error.message); }
  }
  requestAnimationFrame(bucle);
}

window.pararExterno = parar;       // la app de Android lo llama al pasar a segundo plano
$('grabar').addEventListener('click', () => (escuchando ? parar() : empezar()));
const marcar3D = () => $('boton-3d').setAttribute('aria-pressed', String(tresD));
marcar3D();
$('boton-3d').addEventListener('click', () => { tresD = !tresD; localStorage.setItem('signatodo-3d', tresD ? 'si' : 'no'); marcar3D(); });
$('boton-teclado').addEventListener('click', () => { $('escribir').hidden = !$('escribir').hidden; if (!$('escribir').hidden) $('texto-prueba').focus(); });
$('boton-info').addEventListener('click', () => { $('info').hidden = false; });
$('cerrar-info').addEventListener('click', () => { $('info').hidden = true; });
window.addEventListener('resize', ajustar);
// En el navegador se deja de escuchar al ocultar la pestaña. En la app lo decide Android (el diálogo del permiso del
// micrófono puede ocultar la página un momento y no debe parar la escucha).
document.addEventListener('visibilitychange', () => { if (document.hidden && !window.AndroidVoz) parar(); });

(async function arrancar() {
  if (window.AndroidVoz) $('modos').hidden = true;      // en la app no hay servidor para el modo vídeo
  try {
    await Avatar.iniciar(lienzo);
    ajustar();
    motorListo = true;
    estado(window.AndroidVoz || window.SpeechRecognition || window.webkitSpeechRecognition ? 'Listo' : 'Listo (modo de prueba: escribe)');
    if (!(window.AndroidVoz || window.SpeechRecognition || window.webkitSpeechRecognition)) $('escribir').hidden = false;
    requestAnimationFrame(bucle);
  } catch (error) {
    estado('No se ha podido cargar: ' + error.message);
  }
})();
