package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
        int streak;
        /** A habit's reminder time on this phone, "HH:mm", or "". */
        String remind = "";
        int target = 1;
    }

    private WidgetStore() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String parsedFrom;
    private static JSONObject parsed;

    /**
     * Parsed once per snapshot rather than once per call: a redraw asks for
     * it a dozen times, and since 0.199.0 it carries the notes. Preferences
     * hand back the same String until it's replaced, so identity is enough.
     * Nothing may change what this returns.
     */
    static synchronized JSONObject snapshot(Context c) {
        String s = prefs(c).getString(KEY_SNAPSHOT, null);
        if (s == null) return null;
        if (s == parsedFrom) return parsed;
        try {
            parsed = new JSONObject(s);
        } catch (JSONException e) {
            parsed = null;
        }
        parsedFrom = s;
        return parsed;
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

    private static SimpleDateFormat dayFormat() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setLenient(false);
        return f;
    }

    static String today() {
        return dayFormat().format(new Date());
    }

    /** Local midnight of a yyyy-MM-dd date, or null. */
    static Calendar dayOf(String date) {
        try {
            Calendar cal = Calendar.getInstance();
            cal.setTime(dayFormat().parse(date));
            return cal;
        } catch (java.text.ParseException e) {
            return null;
        }
    }

    static String addDays(String date, int n) {
        Calendar cal = dayOf(date);
        if (cal == null) return date;
        cal.add(Calendar.DAY_OF_MONTH, n);
        return dayFormat().format(cal.getTime());
    }

    /** 0 = Sunday, as JavaScript's getDay(). */
    static int weekdayOf(String date) {
        Calendar cal = dayOf(date);
        return cal == null ? -1 : cal.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
    }

    static String nowIso() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    /** optString turns a JSON null into "null", which sorts after every date. */
    static String str(JSONObject o, String key) {
        return o.isNull(key) ? "" : o.optString(key, "");
    }

    // ---- habits ----

    /**
     * Whether a habit asks anything of a date — habits.js's isDue. Worked out
     * here rather than taken from the snapshot, so the widget and the
     * reminders turn over at midnight without waiting for the app to run.
     */
    static boolean dueOn(JSONObject h, String date) {
        String started = str(h, "startedAt");
        if (!started.isEmpty() && date.compareTo(started) < 0) return false;
        JSONArray days = h.optJSONArray("days");
        if (days == null) return true;
        int weekday = weekdayOf(date);
        for (int i = 0; i < days.length(); i++) {
            if (days.optInt(i, -1) == weekday) return true;
        }
        return false;
    }

    /** A date's mark: the widget's latest tick for it, else what the app sent. */
    static int markOn(JSONObject h, JSONArray q, String date) {
        String id = str(h, "id");
        for (int i = q.length() - 1; i >= 0; i--) {
            JSONObject o = q.optJSONObject(i);
            if (o != null && "habit".equals(o.optString("kind")) && id.equals(o.optString("id")) && date.equals(o.optString("date"))) {
                return o.optInt("value", 0);
            }
        }
        JSONObject marks = h.optJSONObject("marks");
        return marks == null ? 0 : marks.optInt(date, 0);
    }

    /**
     * The streak as the app counts it (habits.js's streakOf), on `day`. The
     * app sends `runBefore`: the kept due days in a row that end the day
     * before the snapshot's own today. Days since then are walked here from
     * the week of marks the snapshot carries, plus the widget's ticks; a due
     * day not kept ends the run. `day` itself only ever adds — it isn't over.
     */
    static int streakOn(JSONObject h, JSONArray q, String snapToday, String day) {
        int target = Math.max(1, h.optInt("target", 1));
        int run = 0;
        boolean broken = false;
        String d = addDays(day, -1);
        for (int guard = 0; guard < 400 && d.compareTo(snapToday) >= 0; guard++) {
            if (dueOn(h, d)) {
                if (markOn(h, q, d) >= target) run++;
                else { broken = true; break; }
            }
            d = addDays(d, -1);
        }
        if (!broken) run += Math.max(0, h.optInt("runBefore", 0));
        if (dueOn(h, day) && markOn(h, q, day) >= target) run++;
        return run;
    }

    static List<Row> habitRows(Context c) {
        return habitRows(snapshot(c), queue(c), today());
    }

    static List<Row> habitRows(JSONObject snap, JSONArray q, String today) {
        List<Row> rows = new ArrayList<>();
        if (snap == null) return rows;
        JSONArray habits = snap.optJSONArray("habits");
        if (habits == null) return rows;
        String snapToday = snap.optString("today", today);
        for (int i = 0; i < habits.length(); i++) {
            JSONObject h = habits.optJSONObject(i);
            if (h == null || !dueOn(h, today)) continue;
            Row r = new Row();
            r.type = ROW_HABIT;
            r.id = str(h, "id");
            r.text = str(h, "name");
            r.color = parseColor(str(h, "color"), 0xFF5B8CFF);
            r.target = Math.max(1, h.optInt("target", 1));
            r.value = markOn(h, q, today);
            r.done = r.value >= r.target;
            r.streak = streakOn(h, q, snapToday, today);
            r.remind = str(h, "remind");
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

    private static void queueMark(Context c, String id, int value) {
        try {
            JSONObject item = new JSONObject();
            item.put("kind", "habit");
            item.put("id", id);
            item.put("date", today());
            item.put("value", value);
            item.put("at", nowIso());
            enqueue(c, item);
        } catch (JSONException e) {
            // Nothing to queue.
        }
    }

    /** A tap moves the mark on by one and wraps at the target — habits.js's nextMark. */
    static void tickHabit(Context c, String id) {
        if (id == null) return;
        for (Row r : habitRows(c)) {
            if (!r.id.equals(id)) continue;
            queueMark(c, id, r.value >= r.target ? 0 : r.value + 1);
            return;
        }
    }

    /** A reminder's Done: all the way to the target, however far along it was. */
    static void finishHabit(Context c, String id) {
        if (id == null) return;
        for (Row r : habitRows(c)) {
            if (r.id.equals(id) && !r.done) queueMark(c, id, r.target);
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
     * The to-do view's panels, as the app draws them: a heading per list
     * (left off when only one is showing), the open to-dos in hand order,
     * then an "N done" line and the finished ones, newest first. Something
     * ticked on the widget joins the top of the finished ones straight away,
     * and one unticked goes back to the foot of the open ones, before the app
     * has seen either. A widget set to certain lists (0.199.0) gets theirs.
     */
    static List<Row> todoRows(Context c, int widgetId) {
        return todoRows(snapshot(c), queue(c), listsOf(config(c, widgetId)));
    }

    static List<Row> todoRows(JSONObject snap, JSONArray q) {
        return todoRows(snap, q, null);
    }

    /** The list ids a to-do widget is set to, or null for all of them. */
    static java.util.Set<String> listsOf(JSONObject cfg) {
        JSONArray a = cfg == null ? null : cfg.optJSONArray("lists");
        if (a == null || a.length() == 0) return null;
        java.util.Set<String> out = new java.util.HashSet<>();
        for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    /** The one list a to-do widget shows, as { id, name, color }, when it's set to exactly one that still exists. */
    static JSONObject singleList(JSONObject snap, java.util.Set<String> lists) {
        if (snap == null || lists == null || lists.size() != 1) return null;
        JSONArray all = snap.optJSONArray("lists");
        String id = lists.iterator().next();
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i);
            if (l != null && id.equals(str(l, "id"))) return l;
        }
        return null;
    }

    static List<Row> todoRows(JSONObject snap, JSONArray q, java.util.Set<String> lists) {
        List<Row> rows = new ArrayList<>();
        if (snap == null) return rows;
        JSONArray todos = snap.optJSONArray("todos");
        if (todos == null) return rows;
        JSONObject doneCount = snap.optJSONObject("doneCount");

        Map<String, List<JSONObject>> panels = new LinkedHashMap<>();
        Map<String, String> panelList = new LinkedHashMap<>();
        Map<String, Integer> panelColor = new LinkedHashMap<>();
        // Every list shown gets its panel, empty ones too: its heading is
        // where you add to it (0.199.0). Older snapshots haven't the lists.
        JSONArray all = snap.optJSONArray("lists");
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i);
            if (l == null || (lists != null && !lists.contains(str(l, "id")))) continue;
            panels.put(str(l, "name"), new ArrayList<>());
            panelList.put(str(l, "name"), str(l, "id"));
            panelColor.put(str(l, "name"), parseColor(str(l, "color"), 0));
        }
        for (int i = 0; i < todos.length(); i++) {
            JSONObject t = todos.optJSONObject(i);
            if (t == null) continue;
            if (lists != null && !lists.contains(str(t, "list"))) continue;
            String cat = str(t, "category");
            List<JSONObject> list = panels.get(cat);
            if (list == null) panels.put(cat, list = new ArrayList<>());
            list.add(t);
            panelList.put(cat, str(t, "list"));
        }
        boolean titled = panels.size() > 1 || (panels.size() == 1 && !panels.containsKey("") && (lists == null || lists.size() != 1));

        for (Map.Entry<String, List<JSONObject>> panel : panels.entrySet()) {
            String cat = panel.getKey();
            List<Row> open = new ArrayList<>();
            List<Row> justDone = new ArrayList<>();
            List<Row> done = new ArrayList<>();
            int color = panelColor.containsKey(cat) ? panelColor.get(cat) : 0;
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
                h.id = panelList.get(cat);
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

    static int openTodoCount(List<Row> rows) {
        int n = 0;
        for (Row r : rows) if (r.type == ROW_TODO && !r.done) n++;
        return n;
    }

    /**
     * `checked` is the state a widget checkbox has already moved to (Android
     * 12 and up), so the queue can't disagree with what's on screen; null
     * means a plain tap, which flips it.
     */
    static void tickTodo(Context c, String id, Boolean checked) {
        if (id == null) return;
        for (Row r : todoRows(snapshot(c), queue(c))) {
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

    // ---- notes (0.199.0) ----

    /** The notes the app sent, or null from an app older than the note widgets. */
    static JSONArray notes(JSONObject snap) {
        return snap == null ? null : snap.optJSONArray("notes");
    }

    static JSONObject noteById(JSONArray notes, String id) {
        if (notes == null || id == null || id.isEmpty()) return null;
        for (int i = 0; i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n != null && id.equals(str(n, "id"))) return n;
        }
        return null;
    }

    /**
     * A placed widget's own settings (0.199.0): which note, what a random one
     * draws from, which lists a to-do widget shows.
     */
    static JSONObject config(Context c, int widgetId) {
        String s = prefs(c).getString("widget:" + widgetId, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    static void saveConfig(Context c, int widgetId, JSONObject cfg) {
        prefs(c).edit().putString("widget:" + widgetId, cfg.toString()).commit();
    }

    static void dropConfig(Context c, int widgetId) {
        prefs(c).edit().remove("widget:" + widgetId).apply();
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

    /**
     * "#rrggbb" (or "#aarrggbb") to a colour int. Plain Java rather than
     * Color.parseColor, so the row logic runs in a JVM unit test, where every
     * android.* method is a stub that throws.
     */
    static int parseColor(String s, int fallback) {
        if (s == null || !s.matches("#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?")) return fallback;
        long v = Long.parseLong(s.substring(1), 16);
        return (int) (s.length() == 7 ? v | 0xFF000000L : v);
    }

    /** What opens the app with an action for it to run (see WidgetsPlugin). */
    static Intent launch(Context c, String action) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (i == null) i = new Intent();
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (action != null) i.putExtra(EXTRA_ACTION, action);
        return i;
    }

    /** Opens the app with an action for it to run (see WidgetsPlugin). */
    static PendingIntent openApp(Context c, String action, int requestCode) {
        return openAppOn(c, action, requestCode, null);
    }

    /**
     * The same, told apart from its siblings by `data` — one per habit row,
     * where the request code alone would give every row the first one's.
     */
    static PendingIntent openAppOn(Context c, String action, int requestCode, android.net.Uri data) {
        Intent i = launch(c, action);
        if (data != null) i.setData(data);
        return PendingIntent.getActivity(c, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** A list row's click fills in the template, so the template must be mutable from 12 on. */
    static int mutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
    }

    static void refreshAll(Context c) {
        Reminders.clearKept(c);
        HabitsWidget.refresh(c);
        TodosWidget.refresh(c);
        QuickAddWidget.refresh(c);
        SpendWidget.refresh(c);
        NoteWidget.refresh(c);
        RandomNoteWidget.refresh(c);
    }

    static String pendingNote(Context c) {
        int n = pendingCount(c);
        if (n == 0) return null;
        return n == 1 ? "1 tick syncs when you open LifeLog" : n + " ticks sync when you open LifeLog";
    }
}
