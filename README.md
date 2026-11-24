# Signatodo

Prototipo que, a partir del audio de un vídeo, muestra en un recuadro la signación en
lengua de signos española (LSE) sincronizada con subtítulos. Tiene dos modos:

- **Tarjetas**: un dibujo por palabra, o deletreo dactilológico si no hay signo.
- **Avatar (prueba)**: un personaje 2D de trazo de línea que enlaza los signos con
  movimiento real, cara con expresiones básicas y boca que vocaliza.

> Es un prototipo educativo sin ánimo de lucro. Signa palabra a palabra en el orden del
> castellano, no con la gramática de la LSE, y no lo ha validado ninguna persona sorda ni
> intérprete. No sustituye a la interpretación en LSE.

## Requisitos

- Windows con Python 3.13 (app) y Python 3.12 (solo para extraer poses con MediaPipe).
- ffmpeg en el PATH.
- `py -m pip install faster-whisper simplemma pymupdf pillow numpy`
- `py -3.12 -m pip install mediapipe opencv-python numpy`

## Uso

```
py servidor.py                      # abre http://localhost:8765
py procesar.py videos\mi_video.mp4  # transcribe y prepara los signos (o botón en la web)
py exportar.py videos\mi_video.mp4  # mp4 con recuadro y subtítulos pegados (o botón en la web)
```

En la web: elegir vídeo, marcar «Avatar (prueba)» y reproducir. El vídeo `prueba-lenta`
tiene movimiento para todos sus signos.

## Habla rápida

El avatar no persigue cada palabra: planifica por frases con un desfase de unos 3,5 s, quita
muletillas, y si la frase no cabe condensa por niveles (relleno, verbos de apoyo, matices y
complementos tras preposición) antes de acelerar, sin pasar de 1,2× (1,5× si ya va muy
retrasado). Preguntas, negaciones, cifras y calendario no se recortan nunca; los subtítulos
siempre muestran el texto completo. Si aun así no llega, el selector **Velocidad del vídeo**
frena al orador (el avatar sigue signando a ritmo real).

Vídeos de prueba con el mismo texto a tres velocidades: `test-lenta` (130 palabras/min),
`test-media` (181) y `test-rapida` (233). Retraso máximo medido del avatar:

| Vídeo a… | lenta | media | rápida |
|---|---|---|---|
| velocidad normal | 4,5 s | 6,6 s | 18,1 s |
| 0,75× | 4,6 s | 4,6 s | 7,5 s |

Se parte de los criterios de práctica profesional de interpretación en LSE (síntesis antes
que velocidad, desfase, datos críticos intactos). El uso del espacio y los clasificadores no
está implementado.

## Boca

La boca articula la palabra que se está signando: se convierte en sonidos con las reglas de la
ortografía castellana (qu, gu, ch, ll, h muda, v como b…) y cada sonido tiene su forma de
labios, con interpolación entre ellas.

## Signos ajenos: solo como referencia

En este proyecto los signos, dibujos y vídeos de otras fuentes se usan únicamente como
**referencia** para consultar cómo se hace cada signo. No forman parte del producto ni se
publican aquí, ni siquiera como datos derivados (por ejemplo, movimiento extraído de sus
vídeos). Los movimientos del avatar tienen que ser de creación propia.

Hoy el prototipo todavía se apoya en esos materiales en local para poder probar el planificador,
la boca y el avatar. Esos archivos están fuera del repositorio (`banco/poses/`, `banco/signos/`,
`referencia/`, los PDF) y se sustituirán por signos propios.

Fuentes consultadas y su situación de derechos: `reports/Fuentes de signos LSE.md`.

## Signos propios

El avatar usa por defecto **solo signos de creación propia** (`banco/propios/signos.json`), escritos
en una notación por parámetros: forma de la mano, orientación de dedos y palma, lugar del cuerpo y
movimiento en fotogramas clave. `web/signos.js` los convierte en movimiento: coloca la mano, calcula
cada dedo y resuelve el brazo. No hay vídeos ni datos de terceros en el producto.

Hay 19 signos de prueba (comer, beber, dormir, casa, jugar, niño, niña, ir, contento, noche, leer,
correr, yo, tú, sí, no, hola, adiós, gracias). **Todos son borrador y ninguno ha sido validado por una
persona sorda o un intérprete de LSE.** Las palabras sin signo propio dejan al avatar en reposo.

Para comparar con material ajeno en local, abrir la web con `?referencia=1`: usa también el
movimiento extraído de vídeos de terceros (que no está en el repositorio).

### Lotes de signos (estado)

Además de los 19 iniciales hay 120 signos más en `banco/propios/lotes/` (lotes 001 a 004, de «abajo» a
«coger»), descritos a partir de hojas de consulta de vídeos de referencia: 139 signos en total, de
los que 78 tienen confianza media, 2 alta y 59 baja (tras rehacer los dudosos con fotogramas grandes). Cada uno anota si necesita inclinación del
cuerpo, gesto de cara o gesto de ojos (47 necesitan alguno). Se validan con
`node herramientas/validar_signos.js banco/propios/signos.json banco/propios/lotes/*.json`.

Para describir más: `py herramientas/lotes.py siguiente 30` reserva palabras y
`py herramientas/hoja_referencia.py --grande --salida carpeta --archivo lista.txt` genera las hojas de
consulta (con `--grande` los dedos se leen mucho mejor). Guía de la notación: `herramientas/NOTACION.md`.

## Movimiento: extraído de vídeos reales + gestos propios (vigente)

Por decisión del proyecto, el avatar usa por defecto el **movimiento extraído de vídeos de una persona real
signando** (`banco/poses`, ~3.700 signos, se genera en local con `descargar_arasaac.py` y
`extraer_poses.py`), porque es mucho más natural que los signos descritos con pocos fotogramas clave.
Encima se aplican los **gestos de cuerpo, cabeza, cara y ojos** de los signos propios (`banco/propios`);
las palabras sin vídeo usan el signo propio. Con `?soloPropios=1` en la dirección solo se usan los propios.

Los vídeos de origen son de ARASAAC (Gobierno de Aragón), licencia Creative Commons BY-NC-SA: hay que
citar la fuente, no se puede usar con fin comercial y lo derivado se comparte igual. Los clips extraídos
no se suben al repositorio (están en `.gitignore`).

El botón **Descargar vídeo con signos** graba la reproducción (vídeo + avatar + subtítulos) y la une con el
audio original. Dura lo que dura el vídeo y la pestaña debe quedar a la vista hasta que termine.

## Lista de 500 signos básicos, números y deletreo

- `Documentacion/500_signos_LSE_parametros_querologicos (Gemini).docx`: lista de 500 signos básicos con parámetros
  querológicos, **generada con IA y sin verificar**. `herramientas/lista500.py` la cruza con lo que tenemos:
  327 con movimiento real, 164 con signo propio descrito desde su texto (lotes 101-106) y 9 compuestos
  (`banco/propios/compuestos.json`). `herramientas/cnm_a_nm.py` convierte su «componente no manual» en gestos
  (`banco/propios/gestos.json`). En una comprobación con vídeos reales acertó en comer, dormir, casa y leer,
  falló a medias en agua y hoy, y no coincidió en café.
- **Números**: del 0 al 20 y el 30, con su signo; los demás, cifra a cifra (25 = 2, 5). Suposición pendiente de validar.
- **Deletreo** (`banco/propios/alfabeto.json`, generado por `herramientas/generar_alfabeto.py`): 27 letras. Se deletrean
  nombres propios, siglas y palabras de hasta 4 letras; una palabra deletreada se quita entera o no se quita.
  Discrepancia sin resolver: el manual dibuja la I con el índice y su texto dice meñique (se usó el meñique).
- La app muestra un panel de **fuentes y créditos**, y el vídeo exportado lleva la atribución a ARASAAC.

## Equivalencias entre palabras (sinónimos)

`banco/propios/sinonimos.json` dice qué signo usar cuando una palabra no tiene el suyo: `saludo → saludar`,
`automóvil → coche`, `llamada → llamar`. Cada entrada indica la relación (`nombre-verbo`, `sinonimo`, `aproximada`,
`error-lematizador`) y una confianza (`baja` hasta que lo revise una persona signante). Orden de búsqueda: palabra exacta,
lema, equivalencia, compuesto, deletreo. Al procesar, el resumen lista las palabras resueltas por equivalencia, las
deletreadas y las que se quedan **sin signo**, para ver los huecos antes de exportar.

## Expresión de la cara y lectura labial

- **Capa de expresión por frase** (`construirExpresiones` en `web/avatar.js`): la cara marca la gramática de toda la
  oración, con los tiempos de los signos ya planificados. Pregunta sí/no: cejas arriba y ojos abiertos. Pregunta con
  qué/quién/dónde…: ceño fruncido. Exclamación, negación (la cabeza niega), «sí» (asiente), «si» condicional (cejas hasta la
  coma) y palabras de emoción (alegría, tristeza, enfado, sorpresa, miedo, dolor, duda). La distinción cejas/ceño en
  preguntas y las listas de palabras son hipótesis sin validar por una persona signante.
- **Rótulo de la expresión**: opción «Rotular la expresión de la cara» (activada por defecto) escribe en el recuadro qué marca
  la cara en cada momento; también sale en el vídeo exportado.
- **Lectura labial**: formas de boca exageradas, interior oscuro con dientes y lengua visibles, y la boca termina de decir la
  palabra aunque el signo sea más corto.

### Labios y profundidad de las manos (v2)

- **Labios**: cada sonido se describe con anchura, abertura, redondeo, dientes de arriba y de abajo, lengua (y dónde está) y
  labios apretados. Se dibujan labio de arriba y de abajo con grosor, comisuras, interior oscuro, dientes y lengua. Distingue
  vocales abiertas, extendidas (e, i) y redondeadas (o, u), bilabiales cerradas (b, p, m), la f (labio sobre los dientes), d/t/n/l
  (lengua contra los dientes de arriba), z y c+e/i (lengua entre los dientes, castellano de España) y la s (dientes juntos).
- **Profundidad**: la profundidad grabada de la muñeca es muy ruidosa. En su lugar se deduce del escorzo: cada hueso mide siempre
  lo mismo, y si se ve más corto es que apunta hacia quien mira. Con eso la mano adelantada se dibuja más grande, el antebrazo se
  ensancha hacia la mano, el trazo es más oscuro cuanto más cerca (gris si está lejos) y proyecta una sombra sobre el cuerpo y la
  cara, más separada cuanto más adelantada. El brazo menos adelantado se dibuja detrás. Se asume que las manos van delante del
  cuerpo (no se distingue «delante» de «detrás» por la imagen sola).

### Boca y cejas grabadas (clips v3)

Los vídeos de ARASAAC muestran la cara de la signante, que articula cada palabra mientras signa. `herramientas/extraer_poses.py`
guarda ahora, además del cuerpo y las manos, 9 parámetros de la cara por fotograma (anchura de la boca, abertura interior y
exterior, sonrisa, mandíbula, labios hacia delante, cejas, ojos, mejillas), relativos a la anchura de los ojos. El avatar los usa
para dar forma a la boca (65 % grabada y 35 % sonidos; la lengua y la f vienen de los sonidos) y para mover un poco las cejas. Los
clips sin cara siguen usando solo los sonidos. Para completar los que faltan, sin repetir los que ya la tienen:

    py -3.12 herramientas\extraer_poses.py --cara --lista palabras.txt     (una palabra por línea)
    py -3.12 herramientas\extraer_poses.py --cara --todo                    (todos; varias horas)

## App Android: signar en directo (APK)

`web/directo.html` es una pantalla completa con el avatar y un botón **Grabar**: lo que se oye por el micrófono se signa al
momento y se subtitula. Se puede probar en el navegador (`http://localhost:8765/web/directo.html`; si no hay reconocimiento de voz,
sale un cuadro para escribir frases) y se empaqueta como APK en `android/`.

- **Cómo funciona en el móvil**: un `WebView` muestra la web desde los *assets* del propio APK (nada de internet ni de servidor) y
  un puente (`AndroidVoz`) conecta el reconocedor de voz del sistema (`SpeechRecognizer`, es-ES, resultados parciales) con el
  avatar. Cada palabra se da al avatar cuando es estable; el texto del reconocedor no trae puntuación, así que una pausa o un
  resultado final cierra la frase, y si empieza por qué/quién/dónde… se marca como pregunta.
- **Modo directo** (`directo*` en `web/avatar.js`): no se conoce lo que vendrá, así que no hay anticipo ni planificación por
  frases. Cada signo empieza al llegar su palabra, detrás del anterior; si se acumula retraso se acelera hasta 1,35× y se salta el
  relleno; las manos esperan 1,2 s al siguiente signo antes de bajar. Las expresiones de la cara (pregunta, negación, emoción) se
  aplican al cerrar la frase. Las expresiones de varias palabras («por favor») hacen esperar a la primera palabra hasta 1 s.
- **Lemas**: el móvil no tiene el procesado de Python; `banco/lemas.json` (28 000 formas, `py herramientas/generar_lemas.py`)
  dice que «comiendo» es «comer».
- **Construir el APK** (sin Gradle; usa el SDK y el JDK de Android Studio): `py android/construir.py` (completo, ~40 MB) o
  `py android/construir.py --poses ninguna` (ligero, solo para probar). Sale `android/signatodo.apk`, firmado con una clave de
  pruebas. Para instalarlo: copiarlo al teléfono y abrirlo (permitir «instalar apps desconocidas»), o
  `adb install -r android/signatodo.apk`. Hay que **reconstruirlo** cuando termine la extracción de bocas para que lleve todos los clips.
- **Reconocimiento de voz**: lo hace el sistema (Google en la mayoría de móviles); según el dispositivo puede usar internet.
  Sin ese servicio, la app avisa de que no hay reconocimiento disponible.
- **Licencia**: el APK lleva dentro los movimientos de ARASAAC (CC BY-NC-SA, solo uso no comercial); la pantalla de información
  de la app lo indica. No lo repartas sin cumplirla.

## Avatar en 3D

`web/avatar3d.js` dibuja el mismo muñeco con volumen. Es un motor propio sobre WebGL, sin bibliotecas ni descargas, para que
funcione sin internet y dentro de la app. Se activa con «Avatar en 3D» (modo vídeo) o con el botón «3D» (modo directo); si el
navegador no tiene WebGL, se dibuja el muñeco plano de siempre.

- **Piezas independientes**: todo se construye con una única pieza, una cápsula, que con distintas medidas hace de falange (tres
  por dedo), palma, antebrazo, brazo, hombro, cuello, tronco y cabeza. Cada una se coloca por su cuenta en cada fotograma.
- **De la pose al esqueleto 3D**: las manos usan la profundidad real de cada punto que ya se guardaba. La de los brazos se deduce
  del escorzo (un hueso mide siempre lo mismo; si se ve más corto es que apunta hacia quien mira), con una zona muerta para que
  no tiemblen. La mano nunca queda dentro del cuerpo o de la cabeza: si su sitio en la imagen cae sobre ellos, va por delante.
- **Cabeza y cuerpo**: la cabeza gira, asiente y se ladea de verdad sobre el cuello, y el cuerpo se inclina alrededor de la
  cintura. Los rasgos de la cara (ojos, cejas, boca con labios, dientes y lengua) son los mismos del muñeco plano, pintados en una
  textura que envuelve la cabeza.
- **Profundidad**: sombreado suave, contorno de tinta y **sombras proyectadas** (la mano y el brazo dan sombra sobre el pecho y la
  cara) y una perspectiva suave (lo que se acerca a quien mira se ve algo mayor).
- **Límites**: la imagen sola no dice si un brazo va hacia delante o hacia atrás; se supone que va por delante, que es lo normal al
  signar. El tronco es una forma simple y no hay piernas.

### Revisión del avatar 3D (boca, brazos y expresiones)

- **La boca dice la palabra que se signa**, no la del audio. Mandan los sonidos de la palabra (la boca grabada solo matiza, 25 %).
  En reposo se usan los mismos labios, cerrados, en vez de una raya distinta. Al deletrear o en un signo compuesto, los labios
  dicen la palabra entera repartida entre las letras o las partes («Laura», no «ele, a, u…»). Al abrirse baja la mandíbula más de
  lo que sube el labio de arriba, y la nariz va más alta, para que la boca no la pise.
- **Brazos**: en la grabación el brazo se veía entero, así que nunca estaba dentro del cuerpo. Si un tramo de brazo, antebrazo o
  mano cae sobre el tronco o la cabeza, se adelanta lo justo para pasar por delante. `Avatar.revisar3D(t)` mide cuánto atraviesa
  (0 o menos = nada); en los dos vídeos de prueba, 1.855 fotogramas, no atraviesa ninguno.
- **Expresiones**: el ceño fruncido se leía como enfado. Ahora solo se frunce del todo en los signos y palabras de enfado o asco.
  Las preguntas con qué/quién/dónde llevan las cejas algo bajas y la cabeza ladeada; la negación, solo la cabeza que niega; las
  palabras de enfermedad o agobio, cara de malestar. Las cejas grabadas se miden respecto al reposo de su propio clip.
