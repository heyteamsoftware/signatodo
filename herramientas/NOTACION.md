# Notación de signos propios

Cada signo se describe con parámetros (forma de la mano, orientación, lugar y movimiento) y los
gestos no manuales (cuerpo, cara, ojos). El motor (`web/signos.js`) lo convierte en movimiento del
avatar. **Los vídeos y dibujos de otras fuentes son solo referencia**: se miran para entender cómo se
hace el signo y se describe con esta notación, con valores propios; no se copian datos de ellos.

Los signos están en `banco/propios/` (`signos.json` y `lotes/lote_NNN.json`). Todos son borrador
hasta que los valide una persona sorda o un intérprete de LSE.

## Formato de un signo

```json
"comer": {
  "palabras": ["comer"],           // palabras (minúsculas, con tilde) que activan este signo
  "dur": 1.5,                      // segundos, de 0,4 a 4
  "repetir": 2,                    // opcional: repite el ciclo de las claves de la mano (1 a 5)
  "confianza": "media",            // alta | media | baja: cuánto te fías de tu descripción
  "d": [ ...claves de la mano dominante... ],
  "n": [ ...claves de la otra mano (opcional)... ],
  "nm": { ...gestos no manuales... }
}
```

`d` es la mano dominante (la **derecha** de quien signa; en el vídeo de referencia, la que aparece a la
izquierda de la pantalla si la persona mira a cámara). `n` es la otra. Una mano que no aparece
queda en reposo, relajada, a un lado. En un signo simétrico de dos manos, pon las mismas claves en `d` y `n`.

## Claves de la mano

Cada clave es un instante `t` (de 0 a 1) con lo que cambia. **Lo que no se nombra se mantiene** de la
clave anterior. La primera clave debe tener `t: 0`, lugar (`en` o `pos`), `forma`, `dir` y `pal`.
La última debería tener `t: 1`. Entre claves se interpola de forma suave.

| Campo | Qué es |
|---|---|
| `t` | momento del signo, 0 a 1 |
| `en` | lugar del cuerpo (lista abajo) |
| `pos` | alternativa a `en`: `[x, y, z]` explícito |
| `desp` | desplazamiento `[x, y, z]` que se suma a `en` o `pos` |
| `punto` | qué parte de la mano debe llegar a ese lugar: `puntas`, `indice`, `pulgar`, `corazon`, `meñique`, `nudillos`, `palma`, `muneca` (se mantiene si no se repite) |
| `forma` | forma de la mano (lista abajo) o un objeto propio |
| `dir` | hacia dónde apuntan los dedos |
| `pal` | hacia dónde mira la palma |

### Sistema de coordenadas (por mano)

Unidad = ancho de hombros. Origen entre los hombros. Cada mano usa su propio lado:

- `x`: **+ = hacia fuera, hacia el lado de esa mano**; 0 = línea media del cuerpo; − = cruza hacia el otro lado.
  La mano dominante y la otra usan la misma convención, así que un signo simétrico se escribe igual en `d` y `n`.
- `y`: + = arriba. Hombros = 0, boca ≈ 0,6, ojos ≈ 0,85, frente ≈ 1,1, pecho ≈ −0,25, cintura ≈ −1,1.
- `z`: + = hacia delante (lejos del cuerpo, hacia quien mira). Espacio neutro delante del pecho ≈ 0,5.

### Lugares (`en`)

`frente`, `ojos`, `nariz`, `boca`, `barbilla`, `mejilla`, `sien`, `oreja`, `cuello`, `hombro`, `pecho`,
`vientre`, `neutro` (delante del pecho), `cintura`. Se pueden afinar con `desp`.

### Direcciones (`dir`, `pal`)

Nombres: `arriba`, `abajo`, `adelante`, `atras`, `afuera`, `adentro`. Se combinan con `+`
(`"arriba+adentro"`) o se da un vector `[x, y, z]`. `afuera`/`adentro` son respecto a esa mano (hacia
su lado / hacia el centro del cuerpo). La palma se corrige sola para ser perpendicular a los dedos, así
que basta con indicar hacia dónde mira aproximadamente.

Ejemplos: mano abierta de «parar» = `dir: "arriba"`, `pal: "adelante"`. Mano plana horizontal con la
palma hacia abajo = `dir: "adelante"`, `pal: "abajo"`.

### Formas de mano (`forma`)

`plana`, `abierta` (5 dedos separados), `puño` (pulgar sobre los dedos), `a` (puño con pulgar al
lado), `indice`, `c`, `o`, `piña` (yemas juntas), `v`, `w` (tres dedos), `y`, `l`, `f` (índice y pulgar
se tocan, resto extendido), `garra`, `pico`, `gancho` (índice doblado), `pinza` (índice y pulgar se
pellizcan, resto en puño), `cuernos` (índice y meñique), `cuatro`, `k`, `e`, `curva`, `pulgar` (puño
con pulgar extendido).

Forma propia (objeto):
```json
"forma": { "d": [0, 0, 1, 1], "ab": [10, -8, 0, 0], "p": { "a": -30, "f": [25, 40, 25] } }
```
`d` = flexión de índice, corazón, anular y meñique (0 recto … 1 puño, o `[mcp, pip, dip]` en grados),
`ab` = separación en grados, `p.a` = apertura del pulgar (0 pegado, 90 lateral, negativo = sobre la
palma), `p.f` = flexión del pulgar en sus tres articulaciones.

## Movimiento

- Describe la trayectoria con varias claves: salida, tramos intermedios y llegada.
- Para un gesto que se repite (frotar, golpear, agitar), define **un ciclo** que empieza y acaba en el
  mismo sitio y usa `repetir`.
- Cambia `forma`, `dir` o `pal` en una clave para que la mano se transforme durante el movimiento.
- Para dos manos que se tocan, coloca los dos `punto` en el mismo lugar con un pequeño `desp` de separación.
- El brazo se calcula solo (cinemática): no hace falta indicar el codo. Si pides algo muy lejos del
  cuerpo (|x| > 1,4, z > 1,2) el validador avisa.
- Duración habitual: 0,8 a 1,8 s; signos con varios pasos, hasta 2,5 s.

## Gestos no manuales (`nm`)

Es obligatorio **anotar** en cada signo si necesita inclinación de cuerpo/cabeza, gesto de cara o gesto
de ojos, y **animarlo** si lo necesita:

```json
"nm": {
  "necesita": { "cuerpo": true, "cara": false, "ojos": true },
  "nota": "La cabeza se inclina sobre la mano y los ojos se cierran.",
  "repetir": 2,                                  // opcional, como en las manos
  "claves": [
    { "t": 0,    "cabeza": { "lado": -6 }, "ojos": 1 },
    { "t": 0.35, "cabeza": { "lado": -14 }, "ojos": 0 },
    { "t": 1,    "cabeza": { "lado": -14 }, "ojos": 0 }
  ]
}
```

- `necesita` (tres booleanos) debe ser coherente con `claves`: el validador da error si dices `true` y
  no lo animas, o al revés. Si no necesita ninguno, omite `claves`.
- **cuerpo** cuenta la inclinación del tronco y de la cabeza: `cuerpo: {lado, adelante}` (grados;
  +lado = hacia la derecha de la pantalla, +adelante = se inclina hacia quien mira) y
  `cabeza: {lado, adelante, gira}` (+adelante = baja la barbilla, +gira = hacia la derecha de la pantalla).
  Rangos: cuerpo ±25°, cabeza lado ±30°, adelante −25 a 30°, gira ±40°.
- **cara**: `expr` con una expresión predefinida (`alegria`, `tristeza`, `enfado`, `sorpresa`, `miedo`,
  `asco`, `duda`, `pregunta`, `negacion`, `enfasis`, `cansancio`, `concentracion`, `dolor`, `inflar`,
  `neutra`) y/o ajustes finos: `cejas` (−1 a 1), `ceño` (−1 triste … 1 enfado), `sonrisa` (−1 a 1),
  `boca` (0 a 1, boca abierta de sorpresa), `mejillas` (0 a 1, infladas).
- **ojos**: `ojos` (0 cerrados, 1 normales, hasta 1,4 muy abiertos) y `mirada: [x, y]` (−1 a 1; +x =
  derecha de la pantalla, +y = arriba).
- La boca articula sola la palabra mientras se signa; no hay que describirlo.
- Una `expr` sustituye cejas, ceño, ojos, sonrisa, boca y mejillas; los ajustes sueltos que le pongas en
  la misma clave se aplican después.
- Marca `cara: true` cuando la expresión forme parte del significado (alegría, enfado, pregunta,
  negación, esfuerzo…), `cuerpo: true` cuando el torso o la cabeza se muevan, `ojos: true` cuando los
  ojos o la mirada participen (cerrar, entornar, mirar a un sitio).

## Ejemplos

Una mano, con gesto de cabeza (`sí`):
```json
"sí": {
  "palabras": ["sí"], "dur": 1.0, "repetir": 2, "confianza": "media",
  "d": [
    {"t": 0,   "pos": [0.15, -0.3, 0.55], "dir": "adelante+arriba", "pal": "abajo", "forma": "puño", "punto": "nudillos"},
    {"t": 0.5, "pos": [0.15, -0.5, 0.55]},
    {"t": 1,   "pos": [0.15, -0.3, 0.55]}
  ],
  "nm": { "necesita": {"cuerpo": true, "cara": true, "ojos": false},
          "nota": "La cabeza asiente a la vez que el puño y la cara es afirmativa.", "repetir": 2,
          "claves": [ {"t": 0, "cabeza": {"adelante": 0}, "sonrisa": 0.4},
                      {"t": 0.5, "cabeza": {"adelante": 10}}, {"t": 1, "cabeza": {"adelante": 0}} ] }
}
```

Dos manos simétricas (`casa`): el mismo bloque en `d` y en `n`. Más ejemplos en `banco/propios/signos.json`.

## Validar

```
node herramientas/validar_signos.js banco/propios/lotes/lote_001.json
```

Un signo no entra bien si tiene errores. Los avisos (mano lejos del cuerpo, confianza sin indicar…)
conviene revisarlos. Una descripción dudosa debe marcarse con `"confianza": "baja"`, no maquillarse.
