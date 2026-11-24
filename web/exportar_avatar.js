// Exporta el vídeo con el avatar y los subtítulos pegados.
//
// La página dibuja cada fotograma (vídeo + recuadro con el avatar + rótulo + subtítulos), lo manda al
// servidor y este lo une con el audio original usando ffmpeg. Hay que dejar la página abierta mientras
// dura. Usa los ajustes de la pantalla: tamaño del recuadro, acercar avatar y subtítulos.

const EXPORTAR_FPS = 25;

// Se coloca en el instante t del vídeo y espera a que el fotograma esté listo.
function buscarInstante(t) {
  return new Promise((resolver) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolver();
    video.addEventListener('seeked', () => requestAnimationFrame(() => resolver()), { once: true });
    video.currentTime = t;
  });
}

// Divide las palabras de un subtítulo en líneas que quepan en el ancho dado.
function partirLineas(g, palabras, ancho) {
  const lineas = [[]];
  let usado = 0;
  const espacio = g.measureText(' ').width;
  palabras.forEach((p, k) => {
    const w = g.measureText(p.texto).width;
    if (usado && usado + espacio + w > ancho) { lineas.push([]); usado = 0; }
    lineas.at(-1).push({ ...p, k, w });
    usado += (usado ? espacio : 0) + w;
  });
  return lineas;
}

function rectRedondeado(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Dibuja en `g` el fotograma del instante t (mismo aspecto que el reproductor).
function dibujarCuadro(g, W, H, t) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const escala = Math.min(W / video.videoWidth, H / video.videoHeight);
  const vw = video.videoWidth * escala, vh = video.videoHeight * escala;
  g.drawImage(video, (W - vw) / 2, (H - vh) / 2, vw, vh);

  // Avatar (en el canvas del reproductor) y rótulo con la palabra que se signa
  const frase = estado.segmento >= 0 ? estado.datos.segmentos[estado.segmento]?.texto || '' : '';
  const segs = estado.datos.segmentos;
  let n = -1;
  for (let i = 0; i < segs.length; i++) if (t >= segs[i].t0 - 0.15 && t <= segs[i].t1 + 0.6) n = i;
  const pregunta = n >= 0 && segs[n].texto.includes('?');
  const palabra = Avatar.pintar(t, { pregunta, zoom: $('ajuste-zoom').value / 100 }) || '';
  const lienzoAvatar = $('avatar');

  const fw = W * Number($('ajuste-ancho').value) / 100;
  const fh = fw * 560 / 600, barra = fw * 0.115;
  const x = W - W * 0.022 - fw, y = H - H * 0.035 - fh - barra;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = W * 0.02; g.shadowOffsetY = W * 0.006;
  rectRedondeado(g, x - W * 0.004, y - W * 0.004, fw + W * 0.008, fh + barra + W * 0.008, W * 0.014);
  g.fillStyle = '#fff'; g.fill();
  g.restore();
  g.save();
  rectRedondeado(g, x, y, fw, fh + barra, W * 0.011);
  g.clip();
  g.fillStyle = '#fff'; g.fillRect(x, y, fw, fh);
  g.drawImage(lienzoAvatar, x, y, fw, fh);
  g.fillStyle = '#111'; g.fillRect(x, y + fh, fw, barra);
  g.fillStyle = '#fff';
  g.font = `700 ${Math.round(W * 0.017)}px "Times New Roman", Times, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.letterSpacing = `${Math.max(1, Math.round(W * 0.001))}px`;
  g.fillText(palabra.toUpperCase(), x + fw / 2, y + fh + barra / 2, fw * 0.92);
  g.restore();

  // Subtítulos, a la izquierda del recuadro
  if (estado.subtitulos && n >= 0) {
    const seg = segs[n];
    const cuerpo = Math.round(W * 0.023);
    g.font = `${cuerpo}px "Segoe UI", system-ui, sans-serif`;
    g.letterSpacing = '0px';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const izq = W * 0.03, anchoMax = W * (1 - 0.03 - (Number($('ajuste-ancho').value) + 5) / 100);
    const lineas = partirLineas(g, seg.palabras, anchoMax - cuerpo);
    const alto = cuerpo * 1.35;
    let base = H * (1 - 0.04) - (lineas.length - 1) * alto;
    const espacio = g.measureText(' ').width;
    for (const linea of lineas) {
      const total = linea.reduce((s, p, i) => s + p.w + (i ? espacio : 0), 0);
      let cx = izq + (anchoMax - total) / 2;
      g.fillStyle = 'rgba(0,0,0,.78)';
      rectRedondeado(g, cx - cuerpo * 0.45, base - cuerpo * 1.05, total + cuerpo * 0.9, cuerpo * 1.3, cuerpo * 0.25);
      g.fill();
      for (const p of linea) {
        const sig = seg.palabras[p.k + 1];
        const ahora = t >= p.t0 && t < (sig?.t0 ?? p.t1);
        g.fillStyle = ahora ? '#f2b84b' : '#fff';
        g.fillText(p.texto, cx, base);
        cx += p.w + espacio;
      }
      base += alto;
    }
  }
}

async function exportarAvatar() {
  const v = videoElegido();
  if (!v || !v.datos || estado.ocupado) return;
  if (typeof MediaRecorder === 'undefined') { avisar('Este navegador no puede grabar el vídeo.'); return; }
  video.pause();
  estado.ocupado = true;
  actualizarBotonProcesar();
  const sesion = 'a' + Date.now().toString(36);
  const W = Math.min(video.videoWidth || 1280, 1280) & ~1;
  const H = Math.round((video.videoHeight || 720) * W / (video.videoWidth || 1280)) & ~1;
  const lienzo = document.createElement('canvas');
  lienzo.width = W; lienzo.height = H;
  const g = lienzo.getContext('2d');
  const velocidadAntes = video.playbackRate, silencioAntes = video.muted;
  try {
    // Se graba la reproducción en tiempo real (dura lo mismo que el vídeo) y el servidor la une con el
    // audio original. El vídeo va a velocidad normal: se vuelve a planificar el avatar para 1×.
    await Avatar.preparar(estado.datos.unidades, estado.banco.tarjetas, estado.datos.segmentos, 1);
    video.muted = true;
    video.defaultPlaybackRate = video.playbackRate = 1;
    await buscarInstante(0);
    dibujarCuadro(g, W, H, 0);

    const tipo = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const grabador = new MediaRecorder(lienzo.captureStream(EXPORTAR_FPS), { mimeType: tipo, videoBitsPerSecond: 8_000_000 });
    const trozos = [];
    grabador.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
    const parado = new Promise((resolver) => { grabador.onstop = resolver; });
    grabador.start(1000);
    const t0 = performance.now();
    await video.play();
    const desfase = (performance.now() - t0) / 1000;           // lo que tarda en arrancar el vídeo tras empezar a grabar

    await new Promise((terminar) => {
      const paso = () => {
        dibujarCuadro(g, W, H, video.currentTime);
        const p = 100 * video.currentTime / video.duration;
        avisar(`Generando el vídeo con el avatar… ${Math.round(p)} %\nDeja esta pestaña a la vista hasta que termine.`, { progreso: p });
        if (video.ended || video.paused) terminar(); else setTimeout(paso, 1000 / EXPORTAR_FPS);
      };
      paso();
    });
    dibujarCuadro(g, W, H, video.duration);
    await new Promise((r) => setTimeout(r, 300));
    grabador.stop();
    await parado;

    avisar('Uniendo imagen y audio…', { progreso: 100 });
    const subida = await fetch(`/api/avatar-grabacion?sesion=${sesion}`, { method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: new Blob(trozos, { type: 'video/webm' }) });
    if (!subida.ok) throw new Error('El servidor no ha aceptado la grabación (¿está reiniciado con esta versión?).');
    const fin = await fetch('/api/avatar-final', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: nombreArchivo(v), sesion, fps: EXPORTAR_FPS, desfase }),
    });
    const datos = await fin.json();
    if (!fin.ok) throw new Error(datos.error || 'No se ha podido unir el vídeo.');
    avisar('');
    ofrecerDescarga(datos.archivo, true);
  } catch (error) {
    avisar('No se ha podido generar el vídeo.\n' + error.message);
    setTimeout(() => { if (!estado.ocupado) avisoDeReposo(); }, 6000);
  } finally {
    video.pause();
    video.defaultPlaybackRate = video.playbackRate = velocidadAntes;
    video.muted = silencioAntes;
    await Avatar.preparar(estado.datos.unidades, estado.banco.tarjetas, estado.datos.segmentos, velocidadAntes);
    video.currentTime = 0;
    estado.ocupado = false;
    actualizarBotonProcesar();
    sincronizar();
  }
}
