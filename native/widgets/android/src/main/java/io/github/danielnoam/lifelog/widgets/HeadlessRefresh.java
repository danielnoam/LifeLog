package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background refresh (0.279.0): every so often, with the app put away, the
 * app is run once with no screen, so the widgets and the phone's alerts
 * catch up with GitHub, the release dates and the Steam prices without
 * anyone opening it.
 *
 * The run is the app itself. A second, invisible WebView loads the same
 * files from the APK at the app's own address (https://localhost, served by
 * AssetClient below, as Capacitor serves them), so it shares the device's
 * copy, the sync base and the per-phone choices in the same IndexedDB and
 * localStorage; src/headless.js then stands in for Capacitor with the small
 * Java object this class gives the page (Shim), and src/app.js's
 * headlessRun does the work and calls done(). Nothing about what a widget
 * or an alert shows is decided here; DROPPED.md's "Widgets syncing on their
 * own" says why not.
 *
 * WorkManager runs it as periodic work: fifteen minutes is the floor,
 * Android picks the moment within each period, and a dozing phone can push
 * it out by an hour or more. The job steps aside while the app is in front
 * (it would be refreshing behind a live copy) or busy in the background.
 * If the run changed this device's copy or the alert choices, the app's
 * own WebView is reloaded the next time it comes to the front: left as it
 * was, it would merge its in-memory copy against a sync base this run has
 * already moved.
 */
public class HeadlessRefresh extends Worker {

    static final String TAG = "LifeLogHeadless";
    static final String WORK = "lifelog-background-refresh";
    static final String KEY_MINUTES = "background_minutes";
    static final String KEY_CHANGED = "background_changed";
    static final String KEY_LAST_RUN = "background_last_run";
    static final int MIN_MINUTES = 15;
    private static final long RUN_LIMIT_MS = 3 * 60 * 1000L;
    private static final String ORIGIN_HOST = "localhost";
    private static final String START_URL = "https://localhost/index.html?headless=1";

    public HeadlessRefresh(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** The setting, from the app: 0 cancels, anything else is clamped to the floor. */
    static void schedule(Context c, int minutes) {
        WorkManager wm = WorkManager.getInstance(c);
        SharedPreferences.Editor ed = WidgetStore.prefs(c).edit();
        if (minutes <= 0) {
            wm.cancelUniqueWork(WORK);
            ed.remove(KEY_MINUTES).apply();
            return;
        }
        int every = Math.max(MIN_MINUTES, minutes);
        ed.putInt(KEY_MINUTES, every).apply();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(HeadlessRefresh.class, every, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR, MIN_MINUTES, TimeUnit.MINUTES)
            .build();
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req);
    }

    /** Whether a run since the app was last in front changed what it holds; cleared on reading. */
    static boolean takeChanged(Context c) {
        SharedPreferences p = WidgetStore.prefs(c);
        boolean changed = p.getBoolean(KEY_CHANGED, false);
        if (changed) p.edit().remove(KEY_CHANGED).apply();
        return changed;
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        if (WidgetsPlugin.inFront() || BackgroundWork.isBusy()) return Result.success();
        CountDownLatch latch = new CountDownLatch(1);
        boolean[] changed = { false };
        WebView[] view = { null };
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> {
            try {
                WebView w = new WebView(c);
                view[0] = w;
                WebSettings s = w.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setDatabaseEnabled(true);
                s.setCacheMode(WebSettings.LOAD_NO_CACHE);
                w.addJavascriptInterface(new Shim(c, w, main, latch, changed), "LifeLogHeadless");
                w.setWebViewClient(new AssetClient(c));
                w.loadUrl(START_URL);
            } catch (Exception e) {
                Log.w(TAG, "couldn't start the run", e);
                latch.countDown();
            }
        });
        boolean finished = false;
        try {
            finished = latch.await(RUN_LIMIT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        CountDownLatch gone = new CountDownLatch(1);
        main.post(() -> {
            try {
                if (view[0] != null) { view[0].stopLoading(); view[0].destroy(); }
            } catch (Exception e) { /* already gone */ }
            gone.countDown();
        });
        try { gone.await(10, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        SharedPreferences.Editor ed = WidgetStore.prefs(c).edit().putLong(KEY_LAST_RUN, System.currentTimeMillis());
        if (changed[0]) ed.putBoolean(KEY_CHANGED, true);
        ed.apply();
        if (!finished) Log.w(TAG, "the run didn't finish in time");
        return Result.success();
    }

    /** What src/headless.js gets in place of Capacitor. Called on the WebView's own thread. */
    static final class Shim {
        private final Context c;
        private final WebView view;
        private final Handler main;
        private final CountDownLatch latch;
        private final boolean[] changed;

        Shim(Context c, WebView view, Handler main, CountDownLatch latch, boolean[] changed) {
            this.c = c;
            this.view = view;
            this.main = main;
            this.latch = latch;
            this.changed = changed;
        }

        /** The snapshot, as WidgetsPlugin.update takes it; then whatever has come due rings. */
        @JavascriptInterface
        public void update(String json) {
            if (json == null) return;
            WidgetStore.saveSnapshot(c, json);
            WidgetStore.refreshAll(c);
            Reminders.fire(c);
        }

        @JavascriptInterface
        public String notePins() {
            return new JSONArray(NoteWidget.pins(c)).toString();
        }

        @JavascriptInterface
        public String notificationState() {
            return Reminders.allowed(c) ? "granted" : "denied";
        }

        /** A GET, answered through window.LifeLogHeadlessFetched(id, json) once it's in. */
        @JavascriptInterface
        public void fetch(String id, String url, String headersJson, boolean noRedirects) {
            new Thread(() -> {
                String answer = request(url, headersJson, noRedirects);
                main.post(() -> {
                    try {
                        view.evaluateJavascript("window.LifeLogHeadlessFetched(" + JSONObject.quote(id) + "," + JSONObject.quote(answer) + ")", null);
                    } catch (Exception e) { /* the run is over */ }
                });
            }, "lifelog-headless-fetch").start();
        }

        @JavascriptInterface
        public void done(boolean didChange, String note) {
            changed[0] = didChange;
            if (note != null && !note.isEmpty()) Log.i(TAG, note);
            latch.countDown();
        }

        @JavascriptInterface
        public void log(String s) {
            Log.i(TAG, String.valueOf(s));
        }
    }

    /** What CapacitorHttp answers with, as platform.js reads it: status, data, headers, url; or error. */
    static String request(String url, String headersJson, boolean noRedirects) {
        JSONObject out = new JSONObject();
        HttpURLConnection conn = null;
        try {
            if (url == null || !url.startsWith("https://")) throw new IOException("only https");
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setInstanceFollowRedirects(!noRedirects);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestMethod("GET");
            if (headersJson != null && !headersJson.isEmpty()) {
                JSONObject h = new JSONObject(headersJson);
                for (Iterator<String> it = h.keys(); it.hasNext();) {
                    String k = it.next();
                    conn.setRequestProperty(k, h.optString(k));
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
            JSONObject headers = new JSONObject();
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty()) headers.put(e.getKey(), e.getValue().get(0));
            }
            out.put("status", status);
            out.put("data", body);
            out.put("headers", headers);
            out.put("url", conn.getURL().toString());
        } catch (Exception e) {
            try { out.put("error", String.valueOf(e.getMessage() == null ? e : e.getMessage())); } catch (Exception x) { /* can't happen */ }
        } finally {
            if (conn != null) conn.disconnect();
        }
        return out.toString();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) buf.write(b, 0, n);
        in.close();
        return buf.toByteArray();
    }

    /**
     * The app's files from the APK, at the address Capacitor serves them from,
     * so the page is the same origin as the app and shares its storage.
     * Anything else (GitHub, the media sources) goes out to the network as
     * the page asks; CORS applies as in a browser, which is why the Steam
     * routes go through Shim.fetch instead.
     */
    static final class AssetClient extends WebViewClient {
        private final Context c;

        AssetClient(Context c) { this.c = c; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null || !ORIGIN_HOST.equals(request.getUrl().getHost())) return null;
            String path = assetPath(request.getUrl().getPath());
            try {
                InputStream in = c.getAssets().open("public/" + path);
                return new WebResourceResponse(mimeOf(path), isText(path) ? "utf-8" : null, in);
            } catch (IOException e) {
                Map<String, String> none = Collections.emptyMap();
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", none, new ByteArrayInputStream(new byte[0]));
            }
        }
    }

    /** "/" and "" are the page; a leading slash is dropped; nothing climbs out. */
    static String assetPath(String path) {
        String p = (path == null ? "" : path).replace("..", "").replaceAll("/+", "/");
        while (p.startsWith("/")) p = p.substring(1);
        if (p.isEmpty() || p.endsWith("/")) p = p + "index.html";
        return p;
    }

    static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("txt", "text/plain");
        MIME.put("md", "text/markdown");
    }

    static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase();
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    static boolean isText(String path) {
        String m = mimeOf(path);
        return m.startsWith("text/") || m.endsWith("json") || m.endsWith("xml") || m.equals("text/javascript");
    }
}
