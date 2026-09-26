package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One note on the home screen (0.199.0), for the note widget and the random
 * one: its category (or kind) above, the words, who said it for a quote, and
 * the date it was written. The whole card opens the note in the app.
 *
 * Small, it's the words alone: below COMPACT the header and the date cost
 * more lines than they're worth. That takes the random widget's ↻ with them,
 * which is why its settings can make it change on a clock instead.
 */
final class NoteCard {

    static final int COMPACT_W = 150;
    static final int COMPACT_H = 110;
    private static final int PAD_DP = 28;
    private static final int HEADER_DP = 36;
    private static final int FOOT_LINE_DP = 18;

    private NoteCard() {}

    static boolean compact(int widthDp, int heightDp) {
        return (widthDp > 0 && widthDp < COMPACT_W) || (heightDp > 0 && heightDp < COMPACT_H);
    }

    /** How many lines of the note fit, with `foot` lines of author and date under it. */
    static int lines(int heightDp, boolean compact, int foot) {
        if (heightDp <= 0) return 8;
        int room = heightDp - PAD_DP - (compact ? 0 : HEADER_DP) - foot * FOOT_LINE_DP;
        return Math.max(1, room / (compact ? 17 : 20));
    }

    /** The words as the widget shows them: a quote in its marks, a list as its title and what's left on it. */
    static String body(JSONObject note) {
        String kind = WidgetStore.str(note, "kind");
        String text = WidgetStore.str(note, "text");
        if ("quote".equals(kind)) return "“" + text + "”";
        if (!"list".equals(kind)) {
            String title = WidgetStore.str(note, "title");
            return title.isEmpty() ? text : text.isEmpty() ? title : title + "\n" + text;
        }
        StringBuilder b = new StringBuilder(text);
        JSONArray items = note.optJSONArray("items");
        int shown = items == null ? 0 : items.length();
        for (int i = 0; i < shown; i++) {
            if (b.length() > 0) b.append('\n');
            b.append("• ").append(items.optString(i));
        }
        int rest = note.optInt("open", shown) - shown;
        if (rest > 0) b.append("\n+").append(rest).append(" more");
        if (note.optInt("open", shown) == 0) b.append(b.length() > 0 ? "\n" : "").append("All done");
        return b.toString();
    }

    /** "— Author, Source" under a quote, or "". */
    static String byline(JSONObject note) {
        if (!"quote".equals(WidgetStore.str(note, "kind"))) return "";
        String a = WidgetStore.str(note, "author"), s = WidgetStore.str(note, "source");
        String by = a.isEmpty() ? s : s.isEmpty() ? a : a + ", " + s;
        return by.isEmpty() ? "" : "— " + by;
    }

    /** The category, else what kind of note it is. */
    static String label(JSONObject note) {
        String cat = WidgetStore.str(note, "category");
        if (!cat.isEmpty()) return cat.toUpperCase(Locale.ROOT);
        String kind = WidgetStore.str(note, "kind");
        return "quote".equals(kind) ? "QUOTE" : "list".equals(kind) ? "LIST" : "NOTE";
    }

    static RemoteViews build(Context c, WidgetSize size, JSONObject note, boolean showDate, PendingIntent open, PendingIntent next) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_note);
        boolean small = compact(size.width, size.height);
        v.setViewVisibility(R.id.note_header, small ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.note_label, label(note));
        int color = WidgetStore.parseColor(WidgetStore.str(note, "color"), 0);
        v.setTextColor(R.id.note_dot, color);
        v.setViewVisibility(R.id.note_dot, color == 0 ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.note_next, next == null ? View.GONE : View.VISIBLE);
        if (next != null) v.setOnClickPendingIntent(R.id.note_next, next);

        String body = body(note);
        String kind = WidgetStore.str(note, "kind");
        SpannableString words = new SpannableString(body);
        String title = WidgetStore.str(note, "list".equals(kind) ? "text" : "title");
        if (!"quote".equals(kind) && !title.isEmpty()) {
            words.setSpan(new StyleSpan(Typeface.BOLD), 0, title.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        } else if ("quote".equals(kind)) {
            words.setSpan(new StyleSpan(Typeface.ITALIC), 0, body.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        v.setTextViewText(R.id.note_text, words);
        v.setTextViewTextSize(R.id.note_text, TypedValue.COMPLEX_UNIT_SP, small ? 13 : 15);

        String by = byline(note);
        String date = showDate && !small ? WidgetStore.str(note, "date") : "";
        v.setTextViewText(R.id.note_by, by);
        v.setViewVisibility(R.id.note_by, by.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.note_date, date);
        v.setViewVisibility(R.id.note_date, date.isEmpty() ? View.GONE : View.VISIBLE);
        int foot = (by.isEmpty() ? 0 : 1) + (date.isEmpty() ? 0 : 1);
        v.setInt(R.id.note_text, "setMaxLines", lines(size.height, small, foot));

        v.setOnClickPendingIntent(R.id.widget_root, open);
        return v;
    }

    /** No note to show: why, and where a tap goes about it. */
    static RemoteViews message(Context c, String label, String text, PendingIntent tap) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_note);
        v.setTextViewText(R.id.note_label, label);
        v.setViewVisibility(R.id.note_dot, View.GONE);
        v.setViewVisibility(R.id.note_next, View.GONE);
        v.setTextViewText(R.id.note_text, text);
        v.setTextViewTextSize(R.id.note_text, TypedValue.COMPLEX_UNIT_SP, 13);
        v.setViewVisibility(R.id.note_by, View.GONE);
        v.setViewVisibility(R.id.note_date, View.GONE);
        v.setOnClickPendingIntent(R.id.widget_root, tap);
        return v;
    }
}
