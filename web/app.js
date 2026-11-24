// Reproductor: vídeo + subtítulos + recuadro de signos sincronizados con el audio.

const $ = (id) => document.getElementById(id);
const video = $('video');
const escena = $('escena');
const recuadro = $('recuadro');
const tarjeta = $('tarjeta');
const rotulo = $('rotulo');
const subtitulos = $('subtitulos');

// Tiempos (en segundos) con los que se reparten las tarjetas.
// OJO: RITMO, construirLinea(), indiceEn() y pintarSubtitulos() están copiados en exportar.py (RITMO,
// construir_linea(), indice_en() y subtitulo_en()) para generar el vídeo con los signos pegados.
// Si se cambia algo aquí hay que cambiarlo también allí (y lo mismo con el aspecto de estilo.css).
const RITMO = {
  signo: 0.60,          // mínimo que se ve un signo antes de pasar al siguiente
  letra: 0.30,          // cada letra del deletreo
  signoRapido: 0.40,    // si vamos con retraso respecto al audio
  letraRapida: 0.17,
  retraso: 0.8,         // a partir de aquí se acelera
  retrasoMaximo: 3.5,   // a partir de aquí se salta el deletreo para alcanzar al audio
  permanencia: 1.6,     // lo que aguanta la última tarjeta antes de pasar a reposo
};

const estado = {
  banco: null,        // banco/indice.json
  datos: null,        // videos/<nombre>.signos.json
  linea: [],          // tarjetas con su instante de entrada
  actual: -1,         // índice de la tarjeta visible (-1 = reposo)
  segmento: -1,       // índice del subtítulo visible
  videos: [],         // lista de /api/videos
  ocupado: false,     // hay un procesado o una exportación en marcha
  avatar: true,       // por defecto solo se usa nuestro avatar; las tarjetas de terceros son opcionales
  deletrear: true,
  subtitulos: true,
};

const sinPuntuacion = (t) => t.replace(/[¿?¡!.,;:"«»()]/g, '').trim();
const reloj = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Línea de tiempo de tarjetas ----------

function construirLinea() {
  const linea = [];
  let cursor = 0;
  for (const u of estado.datos.unidades) {
    if (u.tipo === 'omitir') continue;
    if (u.tipo === 'deletreo' && !estado.deletrear) continue;
    const inicio = Math.max(u.t0, cursor);
    const retraso = inicio - u.t0;
    const conPrisa = retraso > RITMO.retraso;
    if (u.tipo === 'signo') {
      const dura = conPrisa ? RITMO.signoRapido : RITMO.signo;
      linea.push({ t: inicio, fin: inicio + RITMO.permanencia, tipo: 'signo',
        imagen: '/banco/' + estado.banco.tarjetas[u.tarjeta].archivo, texto: sinPuntuacion(u.texto) });
      cursor = inicio + dura;
    } else {
      if (retraso > RITMO.retrasoMaximo) continue;
      const paso = conPrisa ? RITMO.letraRapida : RITMO.letra;
      u.letras.forEach((letra, k) => {
        const ultima = k === u.letras.length - 1;
        linea.push({ t: inicio + k * paso, fin: inicio + (k + 1) * paso + (ultima ? 0.9 : 0), tipo: 'deletreo',
          imagen: '/banco/' + estado.banco.letras[letra], letras: u.letras, posicion: k });
      });
      cursor = inicio + u.letras.length * paso;
    }
  }
  estado.linea = linea;
  estado.actual = -2;   // fuerza a redibujar
}

function indiceEn(t) {
  // Última tarjeta que ya ha entrado en el instante t (búsqueda binaria).
  const linea = estado.linea;
  let a = 0, b = linea.length - 1, r = -1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (linea[m].t <= t) { r = m; a = m + 1; } else { b = m - 1; }
  }
  return r >= 0 && t <= linea[r].fin ? r : -1;
}

function pintarTarjeta(i) {
  if (i === estado.actual) return;
  estado.actual = i;
  if (i < 0) {
    recuadro.classList.add('reposo');
    rotulo.innerHTML = '&nbsp;';
    return;
  }
  const item = estado.linea[i];
  recuadro.classList.remove('reposo');
  const img = new Image();
  img.alt = '';
  img.className = 'entra';
  img.src = item.imagen;
  tarjeta.querySelectorAll('img').forEach((vieja) => vieja.remove());
  tarjeta.appendChild(img);

  if (item.tipo === 'signo') {
    rotulo.textContent = item.texto;
  } else {
    rotulo.replaceChildren(...item.letras.map((letra, k) => {
      const s = document.createElement('span');
      s.className = 'letra' + (k === item.posicion ? ' ahora' : '');
      s.textContent = letra;
      return s;
    }));
  }
  // Precarga las siguientes para que no parpadeen.
  for (const sig of estado.linea.slice(i + 1, i + 6)) new Image().src = sig.imagen;
}

// ---------- Subtítulos ----------

function pintarSubtitulos(t) {
  const segs = estado.datos.segmentos;
  let n = -1;
  if (estado.subtitulos) {
    for (let i = 0; i < segs.length; i++) {
      if (t >= segs[i].t0 - 0.15 && t <= segs[i].t1 + 0.6) n = i;
    }
  }
  if (n !== estado.segmento) {
    estado.segmento = n;
    subtitulos.replaceChildren();
    if (n >= 0) {
      const linea = document.createElement('span');
      linea.className = 'linea';
      segs[n].palabras.forEach((p, k) => {
        const s = document.createElement('span');
        s.textContent = p.texto;
        linea.append(k ? ' ' : '', s);
      });
      subtitulos.appendChild(linea);
    }
  }
  if (n >= 0) {
    const palabras = segs[n].palabras;
    const spans = subtitulos.querySelectorAll('.linea > span');
    palabras.forEach((p, k) => spans[k].classList.toggle('ahora', t >= p.t0 && t < (palabras[k + 1]?.t0 ?? p.t1)));
  }
}

// ---------- Bucle de sincronía ----------

function sincronizar() {
  if (estado.datos) {
    const t = video.currentTime;
    pintarSubtitulos(t);
    if (estado.avatar) {
      // El avatar signa en continuo; en una pregunta levanta las cejas.
      const frase = estado.segmento >= 0 ? estado.datos.segmentos[estado.segmento].texto : '';
      const palabra = Avatar.pintar(t, { pregunta: frase.includes('?'), zoom: $('ajuste-zoom').value / 100 });
      rotulo.textContent = palabra || ' ';
    } else {
      pintarTarjeta(indiceEn(t));
    }
  }
  if (!$('barra').matches(':active')) $('barra').value = video.currentTime;
  $('tiempo').textContent = `${reloj(video.currentTime)} / ${reloj(video.duration || 0)}`;
}

function bucle() {
  sincronizar();
  if (!video.paused && !video.ended) requestAnimationFrame(bucle);
}

// ---------- Carga y procesado ----------

function avisar(texto, { boton = false, progreso = null } = {}) {
  $('aviso').hidden = !texto;
  $('aviso-texto').textContent = texto || '';
  $('aviso-boton').hidden = !boton;
  $('progreso').hidden = progreso === null;
  if (progreso !== null) $('progreso-barra').style.width = progreso + '%';
}

function resumir() {
  const u = estado.datos.unidades;
  const n = (tipo) => u.filter((x) => x.tipo === tipo).length;
  $('resumen').textContent =
    `${n('signo')} palabras con signo · ${n('deletreo')} deletreadas · ${n('omitir')} sin signar (artículos, preposiciones…)`;
}

const nombreArchivo = (v) => decodeURIComponent(v.video.split('/').pop());
const videoElegido = () => estado.videos[$('lista-videos').value];

function actualizarBotonProcesar() {
  const v = videoElegido();
  $('boton-procesar').hidden = !v;
  $('boton-procesar').textContent = v && v.datos ? 'Volver a procesar' : 'Procesar vídeo';
  $('boton-procesar').disabled = estado.ocupado;
  $('lista-videos').disabled = estado.ocupado;
  $('boton-exportar').disabled = estado.ocupado || !v || !v.datos;
  $('boton-exportar').title = estado.avatar
    ? 'Genera un mp4 con el avatar y los subtítulos pegados. Se dibuja fotograma a fotograma en esta página: no la cierres.'
    : 'Genera un mp4 con el recuadro de tarjetas de referencia y los subtítulos pegados';
}

// Lo que tapa el vídeo cuando no hay ningún trabajo en marcha.
function avisoDeReposo() {
  const v = videoElegido();
  if (v && !v.datos) avisar('Este vídeo aún no está procesado.', { boton: true });
  else avisar('');
}

async function cargarVideo(v) {
  video.pause();
  estado.datos = null;
  estado.segmento = -1;
  pintarTarjeta(-1);
  subtitulos.replaceChildren();
  $('resumen').textContent = '';
  video.src = v.video;
  actualizarBotonProcesar();
  if (!v.datos) {
    avisar('Este vídeo aún no está procesado.', { boton: true });
    return;
  }
  avisar('');
  estado.datos = await (await fetch(v.datos)).json();
  construirLinea();
  resumir();
  const avatar = await Avatar.preparar(estado.datos.unidades, estado.banco.tarjetas, estado.datos.segmentos,
    video.playbackRate);
  $('resumen').textContent += ` · avatar: ${avatar.conMovimiento} de ${avatar.signos} signos con movimiento, ${avatar.recortados} condensados, `
    + `retraso máximo ${avatar.retrasoMaximo.toFixed(1)} s, ${avatar.frasesConApuro} frases en modo de apuro`;
  sincronizar();
}

async function cargarLista(seleccionar) {
  estado.videos = await (await fetch('/api/videos')).json();
  const lista = $('lista-videos');
  lista.replaceChildren();
  estado.videos.forEach((v, i) => lista.add(new Option(v.nombre + (v.datos ? '' : ' (sin procesar)'), i)));
  if (!estado.videos.length) {
    actualizarBotonProcesar();
    avisar('No hay vídeos. Copia un mp4 en la carpeta «videos» y recarga la página.');
    return;
  }
  const elegido = Math.max(0, estado.videos.findIndex((v) => nombreArchivo(v) === seleccionar));
  lista.value = elegido;
  await cargarVideo(estado.videos[elegido]);
}

async function procesar() {
  const v = videoElegido();
  if (!v || estado.ocupado) return;
  video.pause();
  const respuesta = await fetch('/api/procesar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video: nombreArchivo(v) }),
  });
  if (!respuesta.ok && respuesta.status !== 409) {     // 409 = ya hay uno en marcha: lo seguimos
    avisar((await respuesta.json()).error, { boton: true });
    return;
  }
  seguirTrabajo();
}

// ---------- Exportar el vídeo con los signos pegados ----------

async function exportar() {
  const v = videoElegido();
  if (!v || !v.datos || estado.ocupado) return;
  if (estado.avatar) return exportarAvatar();      // lo que se ve es el avatar: se exporta el avatar
  video.pause();
  const respuesta = await fetch('/api/exportar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video: nombreArchivo(v),
      ancho: Number($('ajuste-ancho').value),
      deletrear: estado.deletrear,
      subtitulos: estado.subtitulos,
    }),
  });
  if (!respuesta.ok && respuesta.status !== 409) {     // 409 = ya hay un trabajo en marcha: lo seguimos
    // Un servidor arrancado antes de existir la exportación contesta 404 sin JSON: hay que reiniciarlo.
    const motivo = await respuesta.json().then((r) => r.error,
      () => 'El servidor no sabe exportar todavía: ciérralo y vuelve a abrirlo (py servidor.py).');
    avisar('No se ha podido generar el vídeo.\n' + motivo);
    setTimeout(() => { if (!estado.ocupado) avisoDeReposo(); }, 5000);
    return;
  }
  seguirTrabajo();
}

function ofrecerDescarga(archivo, descargarYa) {
  const enlace = $('enlace-descarga');
  enlace.href = archivo;
  enlace.download = '';
  enlace.textContent = `Descargar otra vez «${decodeURIComponent(archivo.split('/').pop())}»`;
  enlace.hidden = false;
  if (descargarYa) enlace.click();
}

// Sigue el trabajo en marcha (procesado o exportación) hasta que termina.
async function seguirTrabajo() {
  estado.ocupado = true;
  actualizarBotonProcesar();
  for (;;) {
    const t = await (await fetch('/api/estado')).json();
    if (t.estado === 'en_curso') {
      const titulo = t.tipo === 'exportar' ? 'Generando el vídeo con signos de' : 'Procesando';
      avisar(`${titulo} «${t.video}»… ${Math.round(t.progreso)} %\n${t.linea}`, { progreso: t.progreso });
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    estado.ocupado = false;
    if (t.tipo === 'exportar') {
      actualizarBotonProcesar();
      if (t.estado === 'error') {
        avisar('No se ha podido generar el vídeo.\n' + t.error);
        setTimeout(() => { if (!estado.ocupado) avisoDeReposo(); }, 8000);
      } else {
        avisoDeReposo();
        if (t.archivo) ofrecerDescarga(t.archivo, true);
      }
    } else if (t.estado === 'error') {
      actualizarBotonProcesar();
      avisar('No se ha podido procesar el vídeo.\n' + t.error, { boton: true });
    } else {
      await cargarLista(t.video);
    }
    return;
  }
}

async function iniciar() {
  estado.banco = await (await fetch('/banco/indice.json')).json();
  await Avatar.iniciar($('avatar'));
  $('lista-videos').addEventListener('change', () => cargarVideo(videoElegido()));
  $('boton-procesar').addEventListener('click', procesar);
  $('aviso-boton').addEventListener('click', procesar);
  $('boton-exportar').addEventListener('click', exportar);
  const t = await (await fetch('/api/estado')).json();
  await cargarLista(t.estado === 'en_curso' ? t.video : undefined);
  if (t.estado === 'en_curso') seguirTrabajo();       // se recargó la página a mitad de un trabajo
  else if (t.tipo === 'exportar' && t.estado === 'listo' && t.archivo) ofrecerDescarga(t.archivo, false);
}

// ---------- Controles ----------

function alternar() { video.paused ? video.play() : video.pause(); }

$('boton-play').addEventListener('click', alternar);
video.addEventListener('click', alternar);
video.addEventListener('play', () => { $('boton-play').textContent = '⏸'; $('boton-play').ariaLabel = 'Pausa'; bucle(); });
video.addEventListener('pause', () => { $('boton-play').textContent = '▶'; $('boton-play').ariaLabel = 'Reproducir'; });
video.addEventListener('seeked', sincronizar);
video.addEventListener('timeupdate', sincronizar);
video.addEventListener('loadedmetadata', () => { $('barra').max = video.duration; sincronizar(); });

$('barra').addEventListener('input', () => { video.currentTime = Number($('barra').value); });

$('boton-sonido').addEventListener('click', () => {
  video.muted = !video.muted;
  $('boton-sonido').textContent = video.muted ? '🔇' : '🔊';
});

$('boton-pantalla').addEventListener('click', () => {
  document.fullscreenElement ? document.exitFullscreen() : escena.requestFullscreen();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    alternar();
  }
});

$('ajuste-ancho').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--ancho-recuadro', e.target.value + '%');
});

$('ajuste-deletreo').addEventListener('change', (e) => {
  estado.deletrear = e.target.checked;
  if (estado.datos) { construirLinea(); sincronizar(); }
});

$('ajuste-velocidad').addEventListener('change', async (e) => {
  // Frenar el vídeo da tiempo al avatar para signar sin acelerar ni perder contenido.
  video.defaultPlaybackRate = video.playbackRate = Number(e.target.value);
  if (!estado.datos) return;
  const avatar = await Avatar.preparar(estado.datos.unidades, estado.banco.tarjetas, estado.datos.segmentos,
    video.playbackRate);
  resumir();
  $('resumen').textContent += ` · avatar: ${avatar.conMovimiento} de ${avatar.signos} signos con movimiento, `
    + `${avatar.recortados} condensados, retraso máximo ${avatar.retrasoMaximo.toFixed(1)} s`;
  sincronizar();
});

$('ajuste-zoom').addEventListener('input', sincronizar);

$('ajuste-tarjetas').addEventListener('change', (e) => {
  estado.avatar = !e.target.checked;
  recuadro.classList.toggle('con-avatar', estado.avatar);
  estado.actual = -2;                 // al volver a las tarjetas, fuerza a redibujar
  actualizarBotonProcesar();
  sincronizar();
});

$('ajuste-subtitulos').addEventListener('change', (e) => {
  estado.subtitulos = e.target.checked;
  sincronizar();
});

iniciar().catch((error) => avisar('No se ha podido cargar: ' + error.message));
