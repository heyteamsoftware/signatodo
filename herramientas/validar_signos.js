// Valida definiciones de signos propios y comprueba que el motor sabe animarlas.
//
//   node herramientas/validar_signos.js banco/propios/lotes/lote_001.json [otro.json ...]
//
// Devuelve un código de salida distinto de 0 si hay errores. Los avisos no lo cambian.
const fs = require('fs');
const Signos = require('../web/signos.js');

const PUNTOS = ['puntas', 'indice', 'pulgar', 'corazon', 'meñique', 'nudillos', 'palma', 'muneca'];
const LIMITES_NM = {
  'cuerpo.lado': [-25, 25], 'cuerpo.adelante': [-25, 25],
  'cabeza.lado': [-30, 30], 'cabeza.adelante': [-25, 30], 'cabeza.gira': [-40, 40],
  cejas: [-1, 1], 'ceño': [-1, 1], ojos: [0, 1.4], sonrisa: [-1, 1], boca: [0, 1], mejillas: [0, 1],
};
const finito = (x) => typeof x === 'number' && Number.isFinite(x);

function validar(id, s) {
  const errores = [], avisos = [];
  const e = (m) => errores.push(m), a = (m) => avisos.push(m);

  if (!Array.isArray(s.palabras) || !s.palabras.length || s.palabras.some((p) => typeof p !== 'string' || !p.trim())) e('palabras: lista de textos no vacía');
  if (!finito(s.dur) || s.dur < 0.4 || s.dur > 4) e('dur: segundos entre 0,4 y 4');
  if (s.repetir !== undefined && !(Number.isInteger(s.repetir) && s.repetir >= 1 && s.repetir <= 5)) e('repetir: entero de 1 a 5');
  if (!['alta', 'media', 'baja'].includes(s.confianza)) a('confianza: debería ser alta, media o baja');
  if (!s.d && !s.n) e('Falta la mano: define "d" (dominante) y/o "n"');

  const claves = (lista, nombre) => {
    if (!Array.isArray(lista) || !lista.length) { e(`${nombre}: lista de claves vacía`); return; }
    let anterior = -1;
    lista.forEach((c, i) => {
      const donde = `${nombre}[${i}]`;
      if (!finito(c.t) || c.t < 0 || c.t > 1) e(`${donde}.t debe estar entre 0 y 1`);
      else { if (c.t < anterior) e(`${donde}.t no puede ir hacia atrás`); anterior = c.t; }
      if (c.forma !== undefined && typeof c.forma === 'string' && !Signos.FORMAS[c.forma]) e(`${donde}.forma desconocida: ${c.forma} (válidas: ${Object.keys(Signos.FORMAS).join(', ')})`);
      if (c.forma !== undefined && typeof c.forma === 'object' && !(Array.isArray(c.forma.d) && c.forma.d.length === 4 && Array.isArray(c.forma.ab) && c.forma.p)) e(`${donde}.forma: objeto con d[4], ab[4] y p`);
      for (const campo of ['dir', 'pal']) {
        if (c[campo] !== undefined) { try { Signos.direccion(c[campo]); } catch (x) { e(`${donde}.${campo}: dirección no válida (${JSON.stringify(c[campo])})`); } }
      }
      if (c.en !== undefined && !Signos.LUGARES[c.en]) e(`${donde}.en desconocido: ${c.en} (válidos: ${Object.keys(Signos.LUGARES).join(', ')})`);
      if (c.pos !== undefined) {
        if (!Array.isArray(c.pos) || c.pos.length !== 3 || !c.pos.every(finito)) e(`${donde}.pos: [x, y, z]`);
        else {
          const [x, y, z] = c.pos;
          if (Math.abs(x) > 1.5 || y < -2.1 || y > 1.7 || z < -0.3 || z > 1.4) a(`${donde}.pos ${JSON.stringify(c.pos)} está lejos del cuerpo`);
        }
      }
      if (c.desp !== undefined && !(Array.isArray(c.desp) && c.desp.length === 3 && c.desp.every(finito))) e(`${donde}.desp: [x, y, z]`);
      if (c.punto !== undefined && !PUNTOS.includes(c.punto)) e(`${donde}.punto desconocido: ${c.punto} (válidos: ${PUNTOS.join(', ')})`);
      if (i === 0) {
        if (c.t !== 0) a(`${nombre}[0].t debería ser 0`);
        if (!c.pos && !c.en) e(`${donde}: la primera clave necesita "en" o "pos"`);
        for (const campo of ['forma', 'dir', 'pal']) if (c[campo] === undefined) e(`${donde}: la primera clave necesita "${campo}"`);
      }
    });
    if (lista[lista.length - 1].t !== 1) a(`${nombre}: la última clave debería tener t = 1`);
  };
  if (s.d) claves(s.d, 'd');
  if (s.n) claves(s.n, 'n');

  // ----- Gestos no manuales -----
  const nm = s.nm;
  if (!nm) e('Falta "nm" (gestos no manuales): anota si necesita cuerpo, cara y ojos');
  else {
    const n = nm.necesita;
    if (!n || ['cuerpo', 'cara', 'ojos'].some((k) => typeof n[k] !== 'boolean')) e('nm.necesita: { "cuerpo": bool, "cara": bool, "ojos": bool }');
    if (typeof nm.nota !== 'string' || !nm.nota.trim()) a('nm.nota: explica en una frase qué hacen cuerpo, cara y ojos');
    const usa = { cuerpo: false, cara: false, ojos: false };
    (nm.claves || []).forEach((c, i) => {
      const donde = `nm.claves[${i}]`;
      if (!finito(c.t) || c.t < 0 || c.t > 1) e(`${donde}.t debe estar entre 0 y 1`);
      if (c.expr !== undefined) {
        if (!Signos.EXPRESIONES[c.expr]) e(`${donde}.expr desconocida: ${c.expr} (válidas: ${Object.keys(Signos.EXPRESIONES).join(', ')})`);
        else if (c.expr !== 'neutra') usa.cara = true;
      }
      const mira = (clave, valor) => {
        const lim = LIMITES_NM[clave];
        if (!finito(valor)) e(`${donde}.${clave} debe ser un número`);
        else if (lim && (valor < lim[0] || valor > lim[1])) e(`${donde}.${clave} = ${valor} fuera de rango [${lim[0]}, ${lim[1]}]`);
      };
      if (c.cuerpo) for (const k of Object.keys(c.cuerpo)) { mira('cuerpo.' + k, c.cuerpo[k]); if (c.cuerpo[k]) usa.cuerpo = true; }
      if (c.cabeza) for (const k of Object.keys(c.cabeza)) { mira('cabeza.' + k, c.cabeza[k]); if (c.cabeza[k]) usa.cuerpo = true; }
      for (const k of ['cejas', 'ceño', 'sonrisa', 'boca', 'mejillas']) if (c[k] !== undefined) { mira(k, c[k]); if (c[k]) usa.cara = true; }
      if (c.ojos !== undefined) { mira('ojos', c.ojos); if (c.ojos !== 1) usa.ojos = true; }
      if (c.mirada !== undefined) {
        if (!Array.isArray(c.mirada) || c.mirada.length !== 2 || !c.mirada.every(finito) || c.mirada.some((v) => Math.abs(v) > 1)) e(`${donde}.mirada: [x, y] entre -1 y 1`);
        else if (c.mirada[0] || c.mirada[1]) usa.ojos = true;
      }
    });
    if (n) {
      for (const k of ['cuerpo', 'cara', 'ojos']) {
        if (n[k] === true && !usa[k]) e(`nm.necesita.${k} es true pero nm.claves no lo describe`);
        if (n[k] === false && usa[k]) e(`nm.claves usa ${k} pero nm.necesita.${k} es false`);
      }
    }
  }

  // ----- El motor sabe animarlo y las manos llegan -----
  if (!errores.length) {
    try {
      const { fotogramas } = Signos.generar(s);
      const alcance = Signos.L_BRAZO + Signos.L_ANTEBRAZO - 0.05;
      let fuera = 0;
      fotogramas.forEach((f) => {
        if (![...f.cuerpo, ...f.nm].every(finito)) e('Salen números no finitos al animar');
        if (f.der && Math.hypot(f.cuerpo[12] + 0.5, f.cuerpo[13]) > alcance) fuera++;
        if (f.izq && Math.hypot(f.cuerpo[10] - 0.5, f.cuerpo[11]) > alcance) fuera++;
      });
      if (fuera) a(`La mano queda fuera del alcance del brazo en ${fuera} fotogramas (se recorta al máximo)`);
    } catch (x) { e('El motor no puede animarlo: ' + x.message); }
  }
  return { errores, avisos };
}

let total = 0, malos = 0, avisados = 0;
for (const archivo of process.argv.slice(2)) {
  let datos;
  try { datos = JSON.parse(fs.readFileSync(archivo, 'utf-8')); } catch (x) { console.log(`${archivo}: JSON no válido (${x.message})`); process.exit(2); }
  for (const [id, s] of Object.entries(datos.signos || {})) {
    total++;
    const { errores, avisos } = validar(id, s);
    if (errores.length) malos++;
    if (avisos.length) avisados++;
    for (const m of errores) console.log(`ERROR  ${id}: ${m}`);
    for (const m of avisos) console.log(`aviso  ${id}: ${m}`);
  }
}
console.log(`\n${total} signos: ${total - malos} correctos, ${malos} con errores, ${avisados} con avisos`);
process.exit(malos ? 1 : 0);
