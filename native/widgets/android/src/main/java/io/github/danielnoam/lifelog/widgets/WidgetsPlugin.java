package io.github.danielnoam.lifelog.widgets;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;
import org.json.JSONArray;

/**
 * The app's side of the widgets (see src/widgets.js):
 *
 *   update({ json })   the snapshot the widgets draw from
 *   takeQueue()        ticks made on a widget since last asked, and forgets them
 *   takeLaunchAction() what a widget button asked the app to open, once
 *   notificationState(), askForNotifications(), openNotificationSettings()
 *                      for habit reminders (see Reminders)
 *   biometricState(), authenticate({ title, subtitle })
 *                      the app lock's fingerprint / face unlock (see Biometrics)
 *
 * "Widgets" is the name it started with; it has become the app's one native
 * plugin, and renaming it would only be churn.
 *
 * and two events with nothing in them, each just a nudge to ask: "queued"
 * when a widget is ticked while the app is running, and "action" when a
 * widget button brings the running app to the front.
 */
@CapacitorPlugin(
    name = "Widgets",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = WidgetsPlugin.NOTIFICATIONS) }
)
public class WidgetsPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    private static WeakReference<WidgetsPlugin> live = new WeakReference<>(null);
    private String pendingAction;

    @Override
    public void load() {
        live = new WeakReference<>(this);
        readAction(getActivity().getIntent());
        // The WebView's own scrollbar runs the full height of the screen, over
        // the header and the tab bar, and no CSS reaches it. The page draws its
        // own between them instead (wireScrollThumb in app.js).
        getActivity().runOnUiThread(() -> getBridge().getWebView().setVerticalScrollBarEnabled(false));
    }

    // Capacitor calls this for the launch intent too, not just later ones.
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (readAction(intent)) notifyListeners("action", new JSObject());
    }

    private boolean readAction(Intent intent) {
        if (intent == null) return false;
        String action = intent.getStringExtra(WidgetStore.EXTRA_ACTION);
        if (action == null) return false;
        // Taken off the intent, so recreating the activity doesn't replay it.
        intent.removeExtra(WidgetStore.EXTRA_ACTION);
        pendingAction = action;
        return true;
    }

    static void onQueued() {
        WidgetsPlugin p = live.get();
        if (p != null) p.notifyListeners("queued", new JSObject());
    }

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Must provide json");
            return;
        }
        WidgetStore.saveSnapshot(getContext(), json);
        WidgetStore.refreshAll(getContext());
        Reminders.schedule(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void takeQueue(PluginCall call) {
        JSONArray q = WidgetStore.takeQueue(getContext());
        JSArray items = new JSArray();
        for (int i = 0; i < q.length(); i++) items.put(q.opt(i));
        JSObject ret = new JSObject();
        ret.put("items", items);
        // No redraw here: the app applies these and sends a snapshot that has
        // them, and redrawing in between would flash them unticked.
        call.resolve(ret);
    }

    /**
     * "granted", "denied" or "prompt". Before Android 13 there is nothing to
     * ask for — only the switch in Android's settings, which is granted or not.
     */
    private String notificationState() {
        if (!Reminders.allowed(getContext()) && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "denied";
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
        PermissionState state = getPermissionState(NOTIFICATIONS);
        if (state == PermissionState.GRANTED) return Reminders.allowed(getContext()) ? "granted" : "denied";
        return state == PermissionState.DENIED ? "denied" : "prompt";
    }

    private void resolveState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", notificationState());
        call.resolve(ret);
    }

    @PluginMethod
    public void notificationState(PluginCall call) {
        resolveState(call);
    }

    @PluginMethod
    public void askForNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            resolveState(call);
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        resolveState(call);
    }

    /** Where someone who said no, or turned them off, can turn them back on. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void biometricState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("state", Biometrics.state(getContext()));
        call.resolve(ret);
    }

    /** Resolves { ok, reason, message } — never rejects, so the page has one shape to read. */
    @PluginMethod
    public void authenticate(PluginCall call) {
        String title = call.getString("title", "Unlock LifeLog");
        String subtitle = call.getString("subtitle", "");
        getActivity().runOnUiThread(() -> Biometrics.prompt(getActivity(), title, subtitle, (ok, reason, message) -> {
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            ret.put("reason", reason);
            ret.put("message", message);
            call.resolve(ret);
        }));
    }

    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingAction != null) ret.put("action", pendingAction);
        pendingAction = null;
        call.resolve(ret);
    }
}
