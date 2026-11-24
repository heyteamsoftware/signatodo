package com.signatodo.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * La última versión publicada en el servidor de despliegue y su descarga comprobada.
 *
 * El servidor tiene un archivo version.json (lo escribe herramientas/desplegar.py) con el número de versión, el nombre del
 * APK, su tamaño y su huella SHA-256. Aquí se lee, y el APK se descarga comprobando que el tamaño y la huella coinciden.
 * No usa nada de Android, para poder probarlo en un PC.
 */
final class Actualizacion {
    static final String SERVIDOR = "https://myappsserver.duckdns.org/signatodo/";
    private static final long TAMANO_MAXIMO = 400L * 1024 * 1024;

    final int codigo;          // versionCode: lo que se compara con la versión instalada
    final String nombre;       // versionName, para enseñarlo ("0.5")
    final String apk;          // nombre del archivo en el servidor ("signatodo-0.5.apk")
    final String sha256;       // huella del APK, en hexadecimal
    final long bytes;          // tamaño del APK
    final List<String> notas;  // novedades de la versión

    interface Avance { void progreso(long hechos, long total); }

    private Actualizacion(int codigo, String nombre, String apk, String sha256, long bytes, List<String> notas) {
        this.codigo = codigo; this.nombre = nombre; this.apk = apk; this.sha256 = sha256; this.bytes = bytes; this.notas = notas;
    }

    /** Pregunta al servidor cuál es la última versión. */
    static Actualizacion consultar() throws IOException {
        HttpURLConnection c = abrir(new URL(SERVIDOR + "version.json"));
        try {
            if (c.getResponseCode() != 200) throw new IOException("El servidor responde " + c.getResponseCode());
            ByteArrayOutputStream texto = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] trozo = new byte[4096];
                for (int n; (n = in.read(trozo)) > 0; ) {
                    texto.write(trozo, 0, n);
                    if (texto.size() > 64 * 1024) throw new IOException("version.json demasiado grande");
                }
            }
            return leer(texto.toString("UTF-8"));
        } finally {
            c.disconnect();
        }
    }

    /** Interpreta el texto de version.json. Solo acepta lo que espera: un nombre de archivo sin rutas y una huella completa. */
    static Actualizacion leer(String json) throws IOException {
        String codigo = campo(json, "\"versionCode\"\\s*:\\s*(\\d{1,9})");
        String nombre = campo(json, "\"versionName\"\\s*:\\s*\"([0-9A-Za-z._-]{1,20})\"");
        String apk = campo(json, "\"apk\"\\s*:\\s*\"([0-9A-Za-z._-]{1,80}\\.apk)\"");
        String sha = campo(json, "\"sha256\"\\s*:\\s*\"([0-9a-fA-F]{64})\"");
        String bytes = campo(json, "\"bytes\"\\s*:\\s*(\\d{1,12})");
        if (codigo == null || nombre == null || apk == null || sha == null || bytes == null) throw new IOException("version.json incompleto");
        long tamano = Long.parseLong(bytes);
        if (tamano <= 0 || tamano > TAMANO_MAXIMO) throw new IOException("Tamaño de APK inesperado");
        List<String> notas = new ArrayList<>();
        Matcher lista = Pattern.compile("\"notas\"\\s*:\\s*\\[(.*?)\\]", Pattern.DOTALL).matcher(json);
        if (lista.find()) {
            Matcher m = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(lista.group(1));
            while (m.find() && notas.size() < 6) notas.add(m.group(1).replace("\\\"", "\"").replace("\\\\", "\\"));
        }
        return new Actualizacion(Integer.parseInt(codigo), nombre, apk, sha.toLowerCase(), tamano, notas);
    }

    private static String campo(String json, String patron) {
        Matcher m = Pattern.compile(patron).matcher(json);
        return m.find() ? m.group(1) : null;
    }

    /** Descarga el APK a `destino`. Si el tamaño o la huella no coinciden con lo anunciado, lo borra y falla. */
    void descargar(File destino, Avance avance) throws IOException {
        MessageDigest huella;
        try { huella = MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException e) { throw new IOException(e); }
        HttpURLConnection c = abrir(new URL(SERVIDOR + apk));
        long hechos = 0;
        boolean bien = false;
        try {
            if (c.getResponseCode() != 200) throw new IOException("El servidor responde " + c.getResponseCode());
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] trozo = new byte[64 * 1024];
                for (int n; (n = in.read(trozo)) > 0; ) {
                    hechos += n;
                    if (hechos > bytes) throw new IOException("El archivo es mayor de lo anunciado");
                    out.write(trozo, 0, n);
                    huella.update(trozo, 0, n);
                    if (avance != null) avance.progreso(hechos, bytes);
                }
            }
            if (hechos != bytes) throw new IOException("Descarga incompleta");
            if (!hex(huella.digest()).equals(sha256)) throw new IOException("El archivo descargado no coincide con el publicado");
            bien = true;
        } finally {
            c.disconnect();
            if (!bien) destino.delete();
        }
    }

    private static HttpURLConnection abrir(URL url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(20000);
        c.setInstanceFollowRedirects(false);          // solo este servidor y solo por HTTPS
        c.setUseCaches(false);
        c.setRequestProperty("User-Agent", "Signatodo");
        return c;
    }

    private static String hex(byte[] datos) {
        StringBuilder s = new StringBuilder(datos.length * 2);
        for (byte b : datos) s.append(Character.forDigit((b >> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
        return s.toString();
    }
}
