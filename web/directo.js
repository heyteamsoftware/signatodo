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

function ajustar() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  lienzo.width = Math.round(window.innerWidth * dpr);
  lienzo.height = Math.round(window.innerHeight * dpr);
  const W = lienzo.width, H = lienzo.height;
  // Unidad = ancho de hombros. Las manos llegan a ±1,3 unidades del centro y la figura mide unas 3,1 de alto.
  const u = Math.min(W / 2.7, (H * 0.66) / 3.1);
  zoom = u / (W * 0.245);
  margen = (H * 0.07) / zoom;
}

function estado(texto) { $('estado').textContent = texto; }

// ---------- Voz -> palabras ----------

function procesar(texto, final) {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  const hasta = final ? palabras.length : Math.max(palabras.length - 1, 0);
  if (comprometidas > hasta) comprometidas = Math.min(comprometidas, hasta);     // la hipótesis se ha acortado
  for (let i = comprometidas; i < hasta; i++) Avatar.directoPalabra(palabras[i]);
  comprometidas = Math.max(comprometidas, hasta);
  tentativo = final ? '' : (palabras[palabras.length - 1] || '');
  if (final) { Avatar.directoCerrarFrase(); comprometidas = 0; }
}
window.vozParcial = (texto) => { if (escuchando) procesar(texto, false); };
window.vozFinal = (texto) => { if (escuchando) procesar(texto, true); };
window.vozEstado = (texto) => estado(texto);
window.vozError = (mensaje) => {
  estado(mensaje);
  if (/permiso|no disponible/i.test(mensaje)) parar();
};

function empezar() {
  Avatar.directoIniciar();
  comprometidas = 0; tentativo = '';
  escuchando = true;
  $('grabar').setAttribute('aria-pressed', 'true');
  $('grabar-texto').textContent = 'Parar';
  if (window.AndroidVoz) {
    estado('Escuchando…');
    window.AndroidVoz.iniciar();
  } else if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const Reconocedor = window.SpeechRecognition || window.webkitSpeechRecognition;
    reconocedorWeb = new Reconocedor();
    reconocedorWeb.lang = 'es-ES'; reconocedorWeb.continuous = true; reconocedorWeb.interimResults = true;
    reconocedorWeb.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) procesar(e.results[i][0].transcript, e.results[i].isFinal);
    };
    reconocedorWeb.onerror = (e) => estado('Voz: ' + e.error);
    reconocedorWeb.onend = () => { if (escuchando) { try { reconocedorWeb.start(); } catch { /* ya en marcha */ } } };
    reconocedorWeb.start();
    estado('Escuchando…');
  } else {
    estado('Sin micrófono: escribe una frase');
    $('escribir').hidden = false;
  }
}

function parar() {
  if (!escuchando) return;
  escuchando = false;
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
  if (!escuchando) { Avatar.directoIniciar(); escuchando = true; }
  const palabras = texto.split(/\s+/);
  palabras.forEach((p, i) => setTimeout(() => {
    Avatar.directoPalabra(p);
    if (i === palabras.length - 1) Avatar.directoCerrarFrase();
  }, i * 420));
});

// ---------- Pantalla ----------

function subtitulos() {
  const base = Avatar.directoTexto();
  const caja = $('subtitulos');
  const html = (base ? `<span>${escaparHtml(base)}</span>` : '') + (tentativo ? ` <span class="tentativo">${escaparHtml(tentativo)}</span>` : '');
  if (caja.dataset.html !== html) { caja.innerHTML = html; caja.dataset.html = html; }
}
const escaparHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bucle() {
  Avatar.directoTick();
  Avatar.pintar(Avatar.ahoraDirecto(), { zoom, margen, rotular: false });
  subtitulos();
  requestAnimationFrame(bucle);
}

window.pararExterno = parar;       // la app de Android lo llama al pasar a segundo plano
$('grabar').addEventListener('click', () => (escuchando ? parar() : empezar()));
$('boton-info').addEventListener('click', () => { $('info').hidden = false; });
$('cerrar-info').addEventListener('click', () => { $('info').hidden = true; });
window.addEventListener('resize', ajustar);
document.addEventListener('visibilitychange', () => { if (document.hidden) parar(); });

(async function arrancar() {
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
