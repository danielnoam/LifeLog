package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A different note each time (0.199.0), for bringing old ones back. Its
 * settings (RandomNoteSettingsActivity) say which kinds and categories it
 * draws from, whether it changes every hour, every day or only on ↻, and
 * whether it shows the date. Placed without them it draws from everything,
 * daily, dated.
 *
 * Nothing wakes a widget on the hour, so "every hour" is Android's hourly
 * update (updatePeriodMillis) plus every redraw the app causes: whichever
 * comes first after the hour turns draws a new one.
 */
public class RandomNoteWidget extends AppWidgetProvider {

    static final String ACTION_NEXT = "io.github.danielnoam.lifelog.widgets.NEXT_NOTE";
    static final String EVERY_HOUR = "hour";
    static final String EVERY_DAY = "day";
    static final String EVERY_TAP = "tap";
    private static final Random RANDOM = new Random();

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(c, manager, id, false);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        draw(c, manager, id, false);
    }

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.dropConfig(c, id);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (ACTION_NEXT.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            if (id != AppWidgetManager.INVALID_APPWIDGET_ID) draw(c, AppWidgetManager.getInstance(c), id, true);
            return;
        }
        super.onReceive(c, intent);
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : ListWidget.ids(c, RandomNoteWidget.class)) draw(c, manager, id, false);
    }

    /** The settings a widget placed without any has. */
    static JSONObject defaults() {
        JSONObject cfg = new JSONObject();
        try {
            cfg.put("every", EVERY_DAY);
            cfg.put("date", true);
        } catch (JSONException e) {
            // Can't happen with these keys.
        }
        return cfg;
    }

    private static boolean has(JSONArray a, String s) {
        for (int i = 0; a != null && i < a.length(); i++) if (s.equals(a.optString(i))) return true;
        return false;
    }

    /** The notes it may show: of the kinds and categories chosen, or every one where none are. "" is no category. */
    static List<JSONObject> pool(JSONArray notes, JSONObject cfg) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray kinds = cfg.optJSONArray("kinds");
        JSONArray cats = cfg.optJSONArray("cats");
        boolean anyKind = kinds == null || kinds.length() == 0;
        boolean anyCat = cats == null || cats.length() == 0;
        for (int i = 0; notes != null && i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n == null) continue;
            String kind = WidgetStore.str(n, "kind");
            if (!anyKind && !has(kinds, kind.isEmpty() ? "text" : kind)) continue;
            if (!anyCat && !has(cats, WidgetStore.str(n, "category"))) continue;
            out.add(n);
        }
        return out;
    }

    /** Whether the one showing, picked at `at`, has had its time. */
    static boolean due(String every, long at, long now) {
        if (at <= 0) return true;
        if (EVERY_TAP.equals(every)) return false;
        Calendar a = Calendar.getInstance(), b = Calendar.getInstance();
        a.setTimeInMillis(at);
        b.setTimeInMillis(now);
        boolean sameDay = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
        if (EVERY_HOUR.equals(every)) return !sameDay || a.get(Calendar.HOUR_OF_DAY) != b.get(Calendar.HOUR_OF_DAY);
        return !sameDay;
    }

    /** Any note in the pool but the one showing, if there's another. */
    static JSONObject pick(List<JSONObject> pool, String current, Random random) {
        if (pool.isEmpty()) return null;
        if (pool.size() == 1) return pool.get(0);
        List<JSONObject> others = new ArrayList<>();
        for (JSONObject n : pool) if (!WidgetStore.str(n, "id").equals(current)) others.add(n);
        List<JSONObject> from = others.isEmpty() ? pool : others;
        return from.get(random.nextInt(from.size()));
    }

    static void draw(Context c, AppWidgetManager manager, int widgetId, boolean next) {
        JSONObject cfg = WidgetStore.config(c, widgetId);
        if (cfg == null) cfg = defaults();
        JSONArray notes = WidgetStore.notes(WidgetStore.snapshot(c));
        List<JSONObject> pool = pool(notes, cfg);
        String current = WidgetStore.str(cfg, "current");
        JSONObject note = null;
        for (JSONObject n : pool) if (WidgetStore.str(n, "id").equals(current)) note = n;
        long now = System.currentTimeMillis();
        if (next || note == null || due(WidgetStore.str(cfg, "every"), cfg.optLong("at", 0), now)) {
            note = pick(pool, current, RANDOM);
            try {
                cfg.put("current", note == null ? "" : WidgetStore.str(note, "id"));
                cfg.put("at", now);
            } catch (JSONException e) {
                // Picked again next time.
            }
            WidgetStore.saveConfig(c, widgetId, cfg);
        }
        if (note == null) {
            String text = notes == null ? "Open LifeLog once to bring your notes here"
                : notes.length() == 0 ? "No notes yet" : "No notes of the kinds chosen — tap to change them";
            PendingIntent tap = notes != null && notes.length() > 0 ? settings(c, widgetId) : WidgetStore.openApp(c, "add-note", 601);
            manager.updateAppWidget(widgetId, NoteCard.message(c, "RANDOM NOTE", text, tap));
            return;
        }
        String id = WidgetStore.str(note, "id");
        PendingIntent open = WidgetStore.openAppOn(c, "open-note:" + id, 600, Uri.parse("lifelog-widget://random/" + widgetId));
        Intent again = new Intent(c, RandomNoteWidget.class);
        again.setAction(ACTION_NEXT);
        again.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        again.setData(Uri.parse("lifelog-widget://next/" + widgetId));
        PendingIntent nextIntent = PendingIntent.getBroadcast(c, 602, again, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.updateAppWidget(widgetId, NoteCard.build(c, WidgetSize.of(manager, widgetId), note,
            cfg.optBoolean("date", true), open, nextIntent));
    }

    private static PendingIntent settings(Context c, int widgetId) {
        Intent i = new Intent(c, RandomNoteSettingsActivity.class);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        i.setData(Uri.parse("lifelog-widget://settings/" + widgetId));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 603, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
