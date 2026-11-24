package com.signatodo.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;

/**
 * Signatodo en directo: un WebView a pantalla completa que muestra el avatar (web/directo.html) y un puente de voz.
 *
 * Todo el contenido viene de los assets del propio APK, servido en https://app.local/ (no hay servidor ni se carga nada de
 * internet). El reconocimiento de voz lo hace el SpeechRecognizer del sistema, que va mandando al avatar el texto parcial
 * y final de lo que se oye por el micrófono.
 */
public class MainActivity extends Activity {
    private static final String ORIGEN = "app.local";
    private static final int PEDIDO_MICROFONO = 7;

    private WebView web;
    private SpeechRecognizer reconocedor;
    private boolean escuchando = false;
    private boolean silenciado = false;
    private final Handler manejador = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);
        pantallaCompleta();

        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        web.setWebViewClient(new ClienteWeb());
        web.addJavascriptInterface(new Puente(), "AndroidVoz");
        web.loadUrl("https://" + ORIGEN + "/web/directo.html");
    }

    private void pantallaCompleta() {
        View v = getWindow().getDecorView();
        v.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean conFoco) {
        super.onWindowFocusChanged(conFoco);
        if (conFoco) pantallaCompleta();
    }

    // ---------- Contenido local ----------

    private class ClienteWeb extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView vista, WebResourceRequest pedido) {
            Uri uri = pedido.getUrl();
            if (!ORIGEN.equals(uri.getHost())) return respuesta(403, "text/plain", new byte[0]);   // nada de internet
            String ruta = uri.getPath();
            if (ruta == null || ruta.equals("/")) ruta = "/web/directo.html";
            if (ruta.equals("/api/propios")) ruta = "/api_propios.json";
            try {
                InputStream in = getAssets().open(ruta.substring(1));
                return new WebResourceResponse(tipo(ruta), "utf-8", in);
            } catch (IOException e) {
                return respuesta(404, "text/plain", new byte[0]);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
            return !ORIGEN.equals(pedido.getUrl().getHost());                                      // no se sale de la app
        }
    }

    private static WebResourceResponse respuesta(int codigo, String tipo, byte[] datos) {
        return new WebResourceResponse(tipo, "utf-8", codigo, codigo == 404 ? "Not Found" : "Forbidden",
                new HashMap<String, String>(), new ByteArrayInputStream(datos));
    }

    private static String tipo(String ruta) {
        if (ruta.endsWith(".html")) return "text/html";
        if (ruta.endsWith(".js")) return "application/javascript";
        if (ruta.endsWith(".css")) return "text/css";
        if (ruta.endsWith(".json")) return "application/json";
        if (ruta.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // ---------- Puente de voz ----------

    private class Puente {
        @JavascriptInterface
        public void iniciar() {
            runOnUiThread(new Runnable() { public void run() { arrancar(); } });
        }

        @JavascriptInterface
        public void detener() {
            runOnUiThread(new Runnable() { public void run() { detenerVoz(); } });
        }
    }

    private void js(String codigo) {
        final String c = codigo;
        runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript(c, null); } });
    }

    private void aJs(String funcion, String texto) {
        js("window." + funcion + " && window." + funcion + "(" + JSONObject.quote(texto) + ")");
    }

    private void arrancar() {
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PEDIDO_MICROFONO);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            aJs("vozError", "Reconocimiento de voz no disponible en este dispositivo");
            return;
        }
        escuchando = true;
        silenciar(true);
        crearReconocedor();
        escuchar();
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        super.onRequestPermissionsResult(codigo, permisos, resultados);
        if (codigo != PEDIDO_MICROFONO) return;
        if (resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED) arrancar();
        else aJs("vozError", "Sin permiso de micrófono");
    }

    private void crearReconocedor() {
        if (reconocedor != null) reconocedor.destroy();
        reconocedor = SpeechRecognizer.createSpeechRecognizer(this);
        reconocedor.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle b) { aJs("vozEstado", "Escuchando…"); }
            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float f) { }
            @Override public void onBufferReceived(byte[] b) { }
            @Override public void onEndOfSpeech() { }
            @Override public void onEvent(int tipo, Bundle b) { }

            @Override
            public void onPartialResults(Bundle b) {
                String t = primero(b);
                if (t != null) aJs("vozParcial", t);
            }

            @Override
            public void onResults(Bundle b) {
                String t = primero(b);
                if (t != null) aJs("vozFinal", t);
                reiniciar(120);
            }

            @Override
            public void onError(int error) {
                if (!escuchando) return;
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    aJs("vozError", "Sin permiso de micrófono");
                    detenerVoz();
                } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT
                        || error == SpeechRecognizer.ERROR_SERVER) {
                    aJs("vozEstado", "Sin conexión con el servicio de voz");
                    reiniciar(1500);
                } else if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                    crearReconocedor();
                    reiniciar(400);
                } else {
                    reiniciar(150);                                                                // sin voz o sin coincidencias: se sigue
                }
            }
        });
    }

    private static String primero(Bundle b) {
        ArrayList<String> lista = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return lista == null || lista.isEmpty() ? null : lista.get(0);
    }

    private void escuchar() {
        if (!escuchando || reconocedor == null) return;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try {
            reconocedor.startListening(i);
        } catch (RuntimeException e) {
            crearReconocedor();
            reiniciar(400);
        }
    }

    private void reiniciar(long retraso) {
        manejador.postDelayed(new Runnable() { public void run() { escuchar(); } }, retraso);
    }

    private void detenerVoz() {
        escuchando = false;
        manejador.removeCallbacksAndMessages(null);
        if (reconocedor != null) {
            try { reconocedor.stopListening(); } catch (RuntimeException e) { /* ya parado */ }
            reconocedor.destroy();
            reconocedor = null;
        }
        silenciar(false);
    }

    // El reconocedor pita al empezar y al acabar cada tramo; al reiniciarlo continuamente sería insoportable.
    private void silenciar(boolean si) {
        if (si == silenciado) return;
        AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        int orden = si ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
        int[] canales = {AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_SYSTEM};
        for (int c : canales) {
            try { audio.adjustStreamVolume(c, orden, 0); } catch (RuntimeException e) { /* sin permiso (No molestar) */ }
        }
        silenciado = si;
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (escuchando) {
            detenerVoz();
            js("window.pararExterno && window.pararExterno()");
        }
    }

    @Override
    protected void onDestroy() {
        detenerVoz();
        super.onDestroy();
    }
}
