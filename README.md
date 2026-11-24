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
