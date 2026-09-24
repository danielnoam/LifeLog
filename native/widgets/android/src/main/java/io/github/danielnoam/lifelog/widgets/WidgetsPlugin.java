package io.github.danielnoam.lifelog.widgets;

import android.content.Intent;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import org.json.JSONArray;

/**
 * The app's side of the widgets (see src/widgets.js):
 *
 *   update({ json })   the snapshot the widgets draw from
 *   takeQueue()        ticks made on a widget since last asked, and forgets them
 *   takeLaunchAction() what a widget button asked the app to open, once
 *
 * and two events with nothing in them, each just a nudge to ask: "queued"
 * when a widget is ticked while the app is running, and "action" when a
 * widget button brings the running app to the front.
 */
@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {

    private static WeakReference<WidgetsPlugin> live = new WeakReference<>(null);
    private String pendingAction;

    @Override
    public void load() {
        live = new WeakReference<>(this);
        readAction(getActivity().getIntent());
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

    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingAction != null) ret.put("action", pendingAction);
        pendingAction = null;
        call.resolve(ret);
    }
}
