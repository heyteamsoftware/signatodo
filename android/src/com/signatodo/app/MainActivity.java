package com.signatodo.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
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
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;

/**
 * Signatodo en directo: un WebView a pantalla completa que muestra el avatar (web/directo.html) y un puente de voz.
 *
 * Todo el contenido viene de los assets del propio APK, servido en https://app.local/ (no hay servidor ni se carga nada de
 * internet). El reconocimiento de voz lo hace el SpeechRecognizer del sistema, que va mandando al avatar el texto parcial
 * y final de lo que se oye por el micrófono.
 *
 * Lo único que la app pide a internet es si hay una versión nueva (ver Actualizacion): al abrirse lo consulta en el servidor
 * de despliegue y, si la hay y se acepta, la descarga y la instala.
 */
public class MainActivity extends Activity {
    private static final String ORIGEN = "app.local";
    private static final int PEDIDO_MICROFONO = 7;

    private WebView web;
    private SpeechRecognizer reconocedor;
    private boolean escuchando = false;
    private boolean silenciado = false;
    private final Handler manejador = new Handler(Looper.getMainLooper());

    private static final String ACCION_INSTALACION = "com.signatodo.app.INSTALACION";
    private static final long ESPERA_TRAS_POSPONER = 6L * 60 * 60 * 1000;      // «Más tarde»: no se vuelve a preguntar en 6 horas
    private AlertDialog dialogo;
    private BroadcastReceiver receptorInstalacion;
    private boolean actualizando = false;

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
        comprobarActualizacion();
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

        /** La versión instalada, para enseñarla en la pantalla de información. */
        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
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
                    js("window.vozCorte && window.vozCorte()");
                    aJs("vozEstado", "Sin conexión con el servicio de voz");
                    reiniciar(1500);
                } else if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                    js("window.vozCorte && window.vozCorte()");
                    crearReconocedor();
                    reiniciar(400);
                } else {
                    js("window.vozCorte && window.vozCorte()");                                 // lo que se estaba diciendo no se pierde
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
        cerrarDialogo();
        if (receptorInstalacion != null) {
            try { unregisterReceiver(receptorInstalacion); } catch (RuntimeException e) { /* ya quitado */ }
            receptorInstalacion = null;
        }
        super.onDestroy();
    }

    // ---------- Actualización de la app ----------
    //
    // Al abrirse, la app pregunta al servidor de despliegue cuál es la última versión. Si es más nueva que la instalada,
    // lo dice y, si se acepta, descarga el APK (comprobando su tamaño y su huella), y lo instala con el instalador de
    // paquetes del sistema. Android pide confirmación la primera vez; a partir de Android 12, las siguientes
    // actualizaciones que la app se haga a sí misma pueden instalarse sin volver a preguntar.
    // Si no hay conexión o algo falla, no pasa nada: la app sigue funcionando igual.

    private int versionInstalada() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return Integer.MAX_VALUE; }
    }

    private void comprobarActualizacion() {
        new Thread(new Runnable() {
            public void run() {
                try {
                    limpiarDescargas();
                    Thread.sleep(2500);                                     // primero, que la app arranque
                    final Actualizacion nueva = Actualizacion.consultar();
                    if (nueva.codigo <= versionInstalada()) return;
                    SharedPreferences prefs = getSharedPreferences("actualizacion", MODE_PRIVATE);
                    if (System.currentTimeMillis() - prefs.getLong("pospuesta_" + nueva.codigo, 0) < ESPERA_TRAS_POSPONER) return;
                    runOnUiThread(new Runnable() { public void run() { ofrecer(nueva); } });
                } catch (Throwable e) {
                    // sin conexión, servidor caído o respuesta rara: se queda la versión que hay
                }
            }
        }, "actualizacion").start();
    }

    private File archivoDescarga() { return new File(getCacheDir(), "actualizacion.apk"); }

    private void limpiarDescargas() {
        File f = archivoDescarga();
        if (f.exists() && !actualizando) f.delete();
    }

    private void cerrarDialogo() {
        if (dialogo != null) {
            try { dialogo.dismiss(); } catch (RuntimeException e) { /* la ventana ya no está */ }
            dialogo = null;
        }
    }

    private void avisar(String titulo, String mensaje) {
        if (isFinishing() || isDestroyed()) return;
        cerrarDialogo();
        dialogo = new AlertDialog.Builder(this).setTitle(titulo).setMessage(mensaje).setPositiveButton("Entendido", null).show();
    }

    private void ofrecer(final Actualizacion nueva) {
        if (isFinishing() || isDestroyed() || actualizando || escuchando) return;
        StringBuilder texto = new StringBuilder("Signatodo " + nueva.nombre + " · " + Math.round(nueva.bytes / 1e6) + " MB");
        for (String nota : nueva.notas) texto.append("\n\n• ").append(nota);
        cerrarDialogo();
        dialogo = new AlertDialog.Builder(this)
                .setTitle("Hay una versión nueva")
                .setMessage(texto.toString())
                .setCancelable(false)
                .setPositiveButton("Actualizar", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int cual) { descargar(nueva); }
                })
                .setNegativeButton("Más tarde", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int cual) {
                        getSharedPreferences("actualizacion", MODE_PRIVATE).edit().putLong("pospuesta_" + nueva.codigo, System.currentTimeMillis()).apply();
                        pantallaCompleta();
                    }
                })
                .show();
    }

    private void descargar(final Actualizacion nueva) {
        actualizando = true;
        cerrarDialogo();
        dialogo = new AlertDialog.Builder(this).setTitle("Actualizando Signatodo").setMessage("Descargando… 0 %").setCancelable(false).show();
        new Thread(new Runnable() {
            public void run() {
                try {
                    final File destino = archivoDescarga();
                    final int[] ultimo = {-1};
                    nueva.descargar(destino, new Actualizacion.Avance() {
                        public void progreso(long hechos, long total) {
                            final int tanto = (int) (hechos * 100 / Math.max(total, 1));
                            if (tanto == ultimo[0]) return;
                            ultimo[0] = tanto;
                            runOnUiThread(new Runnable() { public void run() { if (dialogo != null) dialogo.setMessage("Descargando… " + tanto + " %"); } });
                        }
                    });
                    runOnUiThread(new Runnable() { public void run() { if (dialogo != null) dialogo.setMessage("Instalando…"); } });
                    instalar(destino);
                } catch (final Throwable e) {
                    actualizando = false;
                    runOnUiThread(new Runnable() { public void run() { avisar("No se ha podido actualizar", mensajeDe(e) + "\n\nLa app sigue con la versión que tenías."); } });
                }
            }
        }, "descarga").start();
    }

    private static String mensajeDe(Throwable e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    /** Entrega el APK descargado al instalador de paquetes del sistema. El resultado llega al receptor de abajo. */
    private void instalar(File apk) throws IOException {
        if (receptorInstalacion == null) {
            receptorInstalacion = new BroadcastReceiver() {
                @Override public void onReceive(Context contexto, Intent aviso) { resultadoInstalacion(aviso); }
            };
            IntentFilter filtro = new IntentFilter(ACCION_INSTALACION);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(receptorInstalacion, filtro, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(receptorInstalacion, filtro);
        }
        PackageInstaller instalador = getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams parametros = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        parametros.setAppPackageName(getPackageName());
        parametros.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) parametros.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = instalador.createSession(parametros);
        PackageInstaller.Session sesion = instalador.openSession(id);
        try {
            try (InputStream in = new FileInputStream(apk); OutputStream out = sesion.openWrite("signatodo", 0, apk.length())) {
                byte[] trozo = new byte[64 * 1024];
                for (int n; (n = in.read(trozo)) > 0; ) out.write(trozo, 0, n);
                sesion.fsync(out);
            }
            Intent aviso = new Intent(ACCION_INSTALACION).setPackage(getPackageName());
            int marcas = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            sesion.commit(PendingIntent.getBroadcast(this, id, aviso, marcas).getIntentSender());
        } catch (IOException | RuntimeException e) {
            sesion.abandon();
            throw new IOException(mensajeDe(e));
        } finally {
            sesion.close();
        }
    }

    private void resultadoInstalacion(Intent aviso) {
        int estado = aviso.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (estado == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android quiere que la persona confirme (y, la primera vez, que permita a Signatodo instalar aplicaciones).
            Intent confirmar = (Intent) aviso.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar != null) {
                try { startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return; } catch (RuntimeException e) { /* se avisa abajo */ }
            }
            actualizando = false;
            avisar("No se ha podido actualizar", "El teléfono no ha abierto la pantalla de instalación.");
        } else if (estado == PackageInstaller.STATUS_SUCCESS) {
            actualizando = false;                 // normalmente no llega: Android cierra la app al sustituirla
            cerrarDialogo();
        } else {
            actualizando = false;
            archivoDescarga().delete();
            String motivo = aviso.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            avisar("No se ha podido actualizar", (estado == PackageInstaller.STATUS_FAILURE_ABORTED ? "Se ha cancelado la instalación." : "La instalación ha fallado" + (motivo == null ? "." : ": " + motivo))
                    + "\n\nLa app sigue con la versión que tenías.");
        }
    }
}
