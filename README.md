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

## Datos que no están en el repositorio

| Qué | Cómo se obtiene |
|---|---|
| Dibujos de signos y alfabeto (`banco/signos`, `banco/dactilologico`) | `py herramientas\construir_banco.py` con los dos PDF de origen en la carpeta del proyecto. No se publican porque sus derechos son de terceros. Sin ellos el modo tarjetas sale vacío; el avatar funciona. |
| Vídeos de referencia de ARASAAC (`referencia/arasaac`, ~900 MB) | `py herramientas\descargar_arasaac.py` |
| Modelo de poses (`referencia/modelos/holistic_landmarker.task`) | Descarga del modelo Holistic Landmarker de MediaPipe |
| Movimiento de más signos (`banco/poses`) | Solo hay una muestra de ~50 signos; `indice.json` lista los ~3.700 posibles. `py -3.12 herramientas\extraer_poses.py --todo` genera el resto (~108 MB, unas 8-12 horas; se puede cortar y reanudar). Antes hay que ejecutar `descargar_arasaac.py`. |

## Créditos y licencias de los datos

- **Movimiento de los signos (`banco/poses`)**: derivado de los vídeos de LSE de
  [ARASAAC](https://arasaac.org) (Gobierno de Aragón), distribuidos con licencia Creative
  Commons BY-NC-SA. Estos datos derivados se comparten bajo la misma licencia: uso sin ánimo
  de lucro, citando la fuente y compartiendo igual.
- **Dibujos de signos** (no incluidos): «Introducción a la comunicación bimodal. Diccionario
  básico», Ministerio de Educación y Ciencia, 1989, ilustraciones de Lorenzo López Salcedo.
- **Voz de los vídeos de prueba**: síntesis de voz de Microsoft (edge-tts).
- El inventario de fuentes de LSE está en `reports/Fuentes de signos LSE.md`.
