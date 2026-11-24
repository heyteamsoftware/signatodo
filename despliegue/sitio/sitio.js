// Signatodo · página de descarga. Sin cookies y sin servicios de terceros.
// Lo único que hace: preguntar si se puede contar la visita (y la descarga) en un contador anónimo, y enseñar el total.
(() => {
  const CLAVE = 'signatodo-consentimiento';       // 'si' | 'no', solo en este navegador
  const CONTADA = 'signatodo-visita-contada';     // fecha del último día en que este navegador sumó su visita
  const CONTADOR = '/signatodo/contador.php';
  const $ = (id) => document.getElementById(id);
  const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento: se preguntará otra vez */ } };
  // Con «No rastrear» o «Global Privacy Control» no se cuenta nada, aunque se haya aceptado.
  const noRastrear = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  const puedeContar = () => leer(CLAVE) === 'si' && !noRastrear;

  function pintarTotal(datos) {
    if (!datos || typeof datos.visitas !== 'number') return;
    $('visitas-n').textContent = datos.visitas.toLocaleString('es-ES');
    $('visitas').hidden = false;
  }
  function enviar(evento) {
    const cuerpo = new URLSearchParams({ evento });
    return fetch(CONTADOR, { method: 'POST', body: cuerpo, credentials: 'omit', keepalive: true }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  function contarVisita() {
    const hoy = new Date().toISOString().slice(0, 10);
    if (!puedeContar() || leer(CONTADA) === hoy) return fetch(CONTADOR, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    guardar(CONTADA, hoy);
    return enviar('visita');
  }

  const aviso = $('consentimiento');
  const responder = (valor) => {
    guardar(CLAVE, valor);
    aviso.hidden = true;
    if (valor === 'si') contarVisita().then(pintarTotal);
  };
  if (aviso) {
    $('consentimiento-si').addEventListener('click', () => responder('si'));
    $('consentimiento-no').addEventListener('click', () => responder('no'));
    if (!leer(CLAVE)) aviso.hidden = false;
  }
  const preferencias = $('preferencias');
  if (preferencias && aviso) preferencias.addEventListener('click', () => { aviso.hidden = false; $('consentimiento-no').focus(); });

  if ($('visitas')) contarVisita().then(pintarTotal);
  const descargar = $('descargar');
  if (descargar) descargar.addEventListener('click', () => { if (puedeContar()) enviar('descarga'); });
})();
