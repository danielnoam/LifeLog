package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * The two Backlog widgets (0.277.0): Upcoming releases and In progress.
 * Both are a titled list of rows the app has already worked out
 * (widgets.js's backlogRows — the order, the colours and the words for a
 * vague date are the app's), and the whole widget opens the view they
 * belong to. What this side adds is the clock: "Today", "In 3 days" and
 * "Since 12 Oct" are counted from the phone's own date, so a widget left
 * for days still counts down, and a release that came out meanwhile
 * drops off rather than staying "In 2 days".
 */
final class BacklogWidgets {
    private BacklogWidgets() {}

    static final int ROW_DP = 22;
    static final int HEAD_DP = 44;

    /** How many rows a widget this tall can show. */
    static int rowsFor(int heightDp) {
        if (heightDp <= 0) return 4;
        return Math.max(1, (heightDp - HEAD_DP) / ROW_DP);
    }

    static int daysBetween(String from, String to) {
        Calendar a = WidgetStore.dayOf(from), b = WidgetStore.dayOf(to);
        if (a == null || b == null) return Integer.MIN_VALUE;
        long ms = b.getTimeInMillis() - a.getTimeInMillis();
        return (int) Math.round(ms / (24.0 * 60 * 60 * 1000));
    }

    static String shortDay(String date) {
        Calendar c = WidgetStore.dayOf(date);
        return c == null ? date : new SimpleDateFormat("d MMM", Locale.getDefault()).format(c.getTime());
    }

    /** The words beside an upcoming row: a countdown for a day, the app's words for a vaguer date. */
    static String upcomingWords(JSONObject r, String today) {
        String label = WidgetStore.str(r, "label");
        String words;
        if (r.optBoolean("exact")) {
            int d = daysBetween(today, WidgetStore.str(r, "day"));
            words = d == 0 ? "Today" : d == 1 ? "Tomorrow" : d > 1 && d <= 14 ? "In " + d + " days" : shortDay(WidgetStore.str(r, "day"));
        } else {
            words = WidgetStore.str(r, "when");
        }
        return label.isEmpty() ? words : label + " · " + words;
    }

    static String progressWords(JSONObject r, String today) {
        int d = daysBetween(WidgetStore.str(r, "startedAt"), today);
        if (d == 0) return "Started today";
        if (d == 1) return "Since yesterday";
        return "Since " + shortDay(WidgetStore.str(r, "startedAt"));
    }

    /**
     * `key` is the snapshot list ("upcoming" or "inProgress"); `empty` what
     * to say when it has nothing. Rows the app sent that the clock has
     * since passed (an upcoming day before today) are left out.
     */
    static RemoteViews build(Context c, WidgetSize size, String title, String key, String action, int reqCode, String empty) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_backlog);
        v.setTextViewText(R.id.widget_title, title);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.openApp(c, action, reqCode));
        v.removeAllViews(R.id.backlog_rows);
        JSONObject snap = WidgetStore.snapshot(c);
        String today = WidgetStore.today();
        JSONArray rows = snap == null ? null : snap.optJSONArray(key);
        String note = null;
        if (snap == null) note = "Open LifeLog once to bring your Backlog here";
        else if (snap.optBoolean("hidden")) note = "Hidden while LifeLog is locked";
        else if (rows == null) note = "Update LifeLog to bring your Backlog here";
        int shown = 0, max = rowsFor(size.height);
        boolean upcoming = "upcoming".equals(key);
        for (int i = 0; note == null && rows != null && i < rows.length() && shown < max; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            if (upcoming && WidgetStore.str(r, "day").compareTo(today) < 0) continue;
            RemoteViews row = new RemoteViews(c.getPackageName(), R.layout.widget_row_when);
            row.setTextColor(R.id.row_dot, WidgetStore.parseColor(WidgetStore.str(r, "color"), 0xFF7A8A99));
            row.setTextViewText(R.id.row_text, (upcoming && r.optBoolean("starred") ? "★ " : "") + WidgetStore.str(r, "title"));
            row.setTextViewText(R.id.row_when, upcoming ? upcomingWords(r, today) : progressWords(r, today));
            v.addView(R.id.backlog_rows, row);
            shown++;
        }
        if (note == null && shown == 0) note = empty;
        v.setTextViewText(R.id.backlog_note, note == null ? "" : note);
        v.setViewVisibility(R.id.backlog_note, note == null ? View.GONE : View.VISIBLE);
        return v;
    }
}
