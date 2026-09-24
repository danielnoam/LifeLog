package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the widgets draw from, and what they hand back.
 *
 * A widget can't run the web app, so the app writes a snapshot here whenever
 * its data changes (WidgetsPlugin.update) and the widgets draw from that.
 * Ticks go the other way through a queue: a widget can't reach GitHub either,
 * so a tick is queued here, shown straight away by overlaying the queue on
 * the snapshot, and applied by the app the next time it runs (takeQueue).
 *
 * The queue keeps one entry per thing ticked — the latest — so ticking and
 * unticking the same to-do is one entry, not two.
 */
final class WidgetStore {

    private static final String PREFS = "lifelog_widgets";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_QUEUE = "queue";
    static final String EXTRA_ACTION = "io.github.danielnoam.lifelog.widgets.ACTION";

    static final int ROW_HEADER = 0;
    static final int ROW_HABIT = 1;
    static final int ROW_TODO = 2;
    static final int ROW_SEP = 3;

    /** One line of a widget's list. */
    static final class Row {
        int type;
        String id = "";
        String text = "";
        int color;
        boolean done;
        /** A habit's mark today; for a to-do ticked on the widget, where its tick sits in the queue. */
        int value;
        int target = 1;
    }

    private WidgetStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject snapshot(Context c) {
        String s = prefs(c).getString(KEY_SNAPSHOT, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    static void saveSnapshot(Context c, String json) {
        prefs(c).edit().putString(KEY_SNAPSHOT, json).apply();
    }

    static synchronized JSONArray queue(Context c) {
        String s = prefs(c).getString(KEY_QUEUE, null);
        if (s == null) return new JSONArray();
        try {
            return new JSONArray(s);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static synchronized JSONArray takeQueue(Context c) {
        JSONArray q = queue(c);
        prefs(c).edit().remove(KEY_QUEUE).commit();
        return q;
    }

    private static String keyOf(JSONObject o) {
        return o.optString("kind") + ":" + o.optString("id") + ":" + o.optString("date");
    }

    private static synchronized void enqueue(Context c, JSONObject item) {
        JSONArray q = queue(c);
        JSONArray out = new JSONArray();
        String key = keyOf(item);
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.optJSONObject(i);
            if (o != null && !key.equals(keyOf(o))) out.put(o);
        }
        out.put(item);
        prefs(c).edit().putString(KEY_QUEUE, out.toString()).commit();
    }

    static int pendingCount(Context c) {
        return queue(c).length();
    }

    // ---- dates, the way the app writes them ----

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** 0 = Sunday, as JavaScript's getDay(). */
    static int weekdayToday() {
        return Calendar.getInstance().get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
    }

    static String nowIso() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    // ---- habits ----

    /**
     * Due today is worked out here rather than taken from the snapshot, so
     * the widget turns over at midnight without waiting for the app to run.
     * Same rules as habits.js's isDue.
     */
    /** optString turns a JSON null into "null", which sorts after every date. */
    static String str(JSONObject o, String key) {
        return o.isNull(key) ? "" : o.optString(key, "");
    }

    static boolean dueToday(JSONObject h, String today, int weekday) {
        String started = str(h, "startedAt");
        if (!started.isEmpty() && today.compareTo(started) < 0) return false;
        JSONArray days = h.optJSONArray("days");
        if (days == null) return true;
        for (int i = 0; i < days.length(); i++) {
            if (days.optInt(i, -1) == weekday) return true;
        }
        return false;
    }

    private static int queuedMark(JSONArray q, String id, String date, int fallback) {
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.optJSONObject(i);
            if (o != null && "habit".equals(o.optString("kind")) && id.equals(o.optString("id")) && date.equals(o.optString("date"))) {
                return o.optInt("value", fallback);
            }
        }
        return fallback;
    }

    static List<Row> habitRows(Context c) {
        List<Row> rows = new ArrayList<>();
        JSONObject snap = snapshot(c);
        if (snap == null) return rows;
        JSONArray habits = snap.optJSONArray("habits");
        if (habits == null) return rows;
        JSONArray q = queue(c);
        String today = today();
        int weekday = weekdayToday();
        for (int i = 0; i < habits.length(); i++) {
            JSONObject h = habits.optJSONObject(i);
            if (h == null || !dueToday(h, today, weekday)) continue;
            Row r = new Row();
            r.type = ROW_HABIT;
            r.id = str(h, "id");
            r.text = str(h, "name");
            r.color = parseColor(str(h, "color"), 0xFF5B8CFF);
            r.target = Math.max(1, h.optInt("target", 1));
            JSONObject marks = h.optJSONObject("marks");
            int saved = marks == null ? 0 : marks.optInt(today, 0);
            r.value = queuedMark(q, r.id, today, saved);
            r.done = r.value >= r.target;
            rows.add(r);
        }
        return rows;
    }

    /** Whether any habit exists at all, as against none being due today. */
    static int habitCount(Context c) {
        JSONObject snap = snapshot(c);
        JSONArray habits = snap == null ? null : snap.optJSONArray("habits");
        return habits == null ? 0 : habits.length();
    }

    /** A tap moves the mark on by one and wraps at the target — habits.js's nextMark. */
    static void tickHabit(Context c, String id) {
        if (id == null) return;
        for (Row r : habitRows(c)) {
            if (!r.id.equals(id)) continue;
            int next = r.value >= r.target ? 0 : r.value + 1;
            try {
                JSONObject item = new JSONObject();
                item.put("kind", "habit");
                item.put("id", id);
                item.put("date", today());
                item.put("value", next);
                item.put("at", nowIso());
                enqueue(c, item);
            } catch (JSONException e) {
                // Nothing to queue.
            }
            return;
        }
    }

    // ---- to-dos ----

    /** Where this to-do's latest tick sits in the queue, or -1. */
    private static int queuedAt(JSONArray q, String id) {
        for (int i = q.length() - 1; i >= 0; i--) {
            JSONObject o = q.optJSONObject(i);
            if (o != null && "todo".equals(o.optString("kind")) && id.equals(o.optString("id"))) return i;
        }
        return -1;
    }

    /**
     * The to-do view's panels, as the app draws them: a heading per category
     * (left off when the general list is the only one), the open to-dos in
     * hand order, then an "N done" line and the finished ones, newest first.
     * Something ticked on the widget joins the top of the finished ones
     * straight away, and one unticked goes back to the foot of the open ones,
     * before the app has seen either.
     */
    static List<Row> todoRows(Context c) {
        return todoRows(snapshot(c), queue(c));
    }

    static List<Row> todoRows(JSONObject snap, JSONArray q) {
        List<Row> rows = new ArrayList<>();
        if (snap == null) return rows;
        JSONArray todos = snap.optJSONArray("todos");
        if (todos == null) return rows;
        JSONObject doneCount = snap.optJSONObject("doneCount");

        Map<String, List<JSONObject>> panels = new LinkedHashMap<>();
        for (int i = 0; i < todos.length(); i++) {
            JSONObject t = todos.optJSONObject(i);
            if (t == null) continue;
            String cat = str(t, "category");
            List<JSONObject> list = panels.get(cat);
            if (list == null) panels.put(cat, list = new ArrayList<>());
            list.add(t);
        }
        boolean titled = panels.size() > 1 || (panels.size() == 1 && !panels.containsKey(""));

        for (Map.Entry<String, List<JSONObject>> panel : panels.entrySet()) {
            String cat = panel.getKey();
            List<Row> open = new ArrayList<>();
            List<Row> justDone = new ArrayList<>();
            List<Row> done = new ArrayList<>();
            int color = 0;
            int unticked = 0;
            for (JSONObject t : panel.getValue()) {
                Row r = new Row();
                r.type = ROW_TODO;
                r.id = str(t, "id");
                r.text = str(t, "text");
                color = parseColor(str(t, "color"), 0);
                boolean saved = t.optBoolean("done");
                int at = queuedAt(q, r.id);
                r.done = at >= 0 ? q.optJSONObject(at).optBoolean("done") : saved;
                if (!r.done) {
                    open.add(r);
                    if (saved) unticked++;
                } else if (!saved) {
                    r.value = at;
                    justDone.add(r);
                } else {
                    done.add(r);
                }
            }
            // The latest tick first, as the newest finished one is in the app.
            Collections.sort(justDone, (a, b) -> b.value - a.value);

            if (titled) {
                Row h = new Row();
                h.type = ROW_HEADER;
                h.text = cat.isEmpty() ? "To do" : cat;
                h.color = color;
                rows.add(h);
            }
            rows.addAll(open);
            // Counted from the app's total, not the rows sent: only the newest
            // few finished ones travel in the snapshot.
            int savedDone = doneCount != null && doneCount.has(cat) ? doneCount.optInt(cat) : done.size() + unticked;
            int doneTotal = savedDone - unticked + justDone.size();
            if (doneTotal > 0 && (justDone.size() + done.size()) > 0) {
                Row sep = new Row();
                sep.type = ROW_SEP;
                sep.text = doneTotal + " done";
                rows.add(sep);
                rows.addAll(justDone);
                rows.addAll(done);
            }
        }
        return rows;
    }

    static int openTodoCount(Context c) {
        int n = 0;
        for (Row r : todoRows(c)) if (r.type == ROW_TODO && !r.done) n++;
        return n;
    }

    /**
     * `checked` is the state a widget checkbox has already moved to (Android
     * 12 and up), so the queue can't disagree with what's on screen; null
     * means a plain tap, which flips it.
     */
    static void tickTodo(Context c, String id, Boolean checked) {
        if (id == null) return;
        for (Row r : todoRows(c)) {
            if (r.type != ROW_TODO || !r.id.equals(id)) continue;
            boolean to = checked != null ? checked : !r.done;
            if (to == r.done) return;
            try {
                JSONObject item = new JSONObject();
                item.put("kind", "todo");
                item.put("id", id);
                item.put("done", to);
                item.put("at", nowIso());
                enqueue(c, item);
            } catch (JSONException e) {
                // Nothing to queue.
            }
            return;
        }
    }

    // ---- what the quick-add buttons may offer ----

    static boolean offers(Context c, String action) {
        JSONObject snap = snapshot(c);
        JSONArray actions = snap == null ? null : snap.optJSONArray("actions");
        // Before the app has ever run there is nothing to go on; offer everything.
        if (actions == null) return true;
        for (int i = 0; i < actions.length(); i++) {
            if (action.equals(actions.optString(i))) return true;
        }
        return false;
    }

    // ---- shared plumbing ----

    static int parseColor(String s, int fallback) {
        try {
            return s == null || s.isEmpty() ? fallback : Color.parseColor(s);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    /** Opens the app with an action for it to run (see WidgetsPlugin). */
    static PendingIntent openApp(Context c, String action, int requestCode) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) i = new Intent();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (action != null) i.putExtra(EXTRA_ACTION, action);
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A list row's click fills in the template, so the template must be mutable from 12 on. */
    static int mutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
    }

    static void refreshAll(Context c) {
        HabitsWidget.refresh(c);
        TodosWidget.refresh(c);
        QuickAddWidget.refresh(c);
    }

    static String pendingNote(Context c) {
        int n = pendingCount(c);
        if (n == 0) return null;
        return n == 1 ? "1 tick syncs when you open LifeLog" : n + " ticks sync when you open LifeLog";
    }
}
