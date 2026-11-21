package io.github.danielnoam.lifelog.widgets;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResultLauncher;
import androidx.health.connect.client.PermissionController;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Health Connect for src/health.js (Android only): habits that tick
 * themselves from steps, workouts and sleep. Read only; the readings go to
 * the page and no further (only the ticks they make sync).
 *
 *   status()                 { sdk, granted } (see HealthReader.status)
 *   request({ background })  Health Connect's own permission screen for
 *                            steps, workouts and sleep, and reading in the
 *                            background when asked; { granted }
 *   read({ from, to, steps, workouts, sleep })  see HealthReader.read
 *   openSettings({ install }) Health Connect's page for LifeLog, or the
 *                            Play Store when it's missing or too old
 */
@CapacitorPlugin(name = "Health")
public class HealthPlugin extends Plugin {

    private final ExecutorService work = Executors.newSingleThreadExecutor();
    private ActivityResultLauncher<Set<String>> asker;
    private PluginCall asking;

    @Override
    public void load() {
        asker = getActivity().registerForActivityResult(
            PermissionController.Companion.createRequestPermissionResultContract(HealthReader.PROVIDER),
            (got) -> {
                PluginCall call = asking;
                asking = null;
                if (call == null) return;
                answerGranted(call);
            });
    }

    @PluginMethod
    public void status(PluginCall call) {
        work.execute(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(HealthReader.status(getContext())));
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (!"available".equals(HealthReader.sdk(getContext()))) {
            call.reject("Health Connect isn't available", "unavailable");
            return;
        }
        Set<String> want = new HashSet<>();
        want.add(HealthReader.STEPS);
        want.add(HealthReader.EXERCISE);
        want.add(HealthReader.SLEEP);
        if (call.getBoolean("background", false)) want.add(HealthReader.BACKGROUND);
        if (asking != null) asking.reject("Asked again", "failed");
        asking = call;
        getActivity().runOnUiThread(() -> {
            try {
                asker.launch(want);
            } catch (Exception e) {
                asking = null;
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        JSONObject opts = call.getData();
        work.execute(() -> {
            try {
                call.resolve(JSObject.fromJSONObject(HealthReader.read(getContext(), opts)));
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String sdk = HealthReader.sdk(getContext());
        Intent i;
        if (call.getBoolean("install", false) || "missing".equals(sdk) || "update".equals(sdk)) {
            i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + HealthReader.PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            i.setPackage("com.android.vending");
        } else if (Build.VERSION.SDK_INT >= 34) {
            i = new Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS");
            i.putExtra(Intent.EXTRA_PACKAGE_NAME, getContext().getPackageName());
        } else {
            i = new Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS");
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            try {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + HealthReader.PROVIDER));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(web);
                call.resolve();
            } catch (Exception x) {
                call.reject("Nothing to open", "failed");
            }
        }
    }

    private void answerGranted(PluginCall call) {
        work.execute(() -> {
            try {
                JSObject out = new JSObject();
                JSArray list = new JSArray();
                for (String p : HealthReader.granted(getContext())) list.put(p);
                out.put("granted", list);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }
}
