package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Calendar widget (Nov 2026): the Home calendar on the home screen.
 * Google Calendar's events, tasks due, backlog releases and next episodes,
 * and what was finished each day, as an agenda (today and the days ahead)
 * or a month with marks under each day, chosen in its settings
 * (CalendarSettingsActivity). There, too, the events can come from the
 * phone's own calendars instead of LifeLog's Google connection
 * (PhoneCalendar): always current, every account on the phone, no app run
 * needed, at the cost of the calendar permission.
 *
 * Words come from the app (widgets.js calendarSnapshot), in its language,
 * and the layout turns right to left with it. Every tap opens the app on
 * that day of the Timeline's calendar; the month's arrows step through the
 * months the app sent, here on the home screen.
 */
public class CalendarWidget extends AppWidgetProvider {

    static final String ACTION_SHIFT = "io.github.danielnoam.lifelog.widgets.CALENDAR_SHIFT";
    static final String EXTRA_DELTA = "delta";
    static final String AGENDA = "agenda", MONTH = "month", APP = "app", PHONE = "phone";

    private static final int ROW_DP = 24;
    private static final int HEAD_DP = 52;
    private static final int MARKS = 4;

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(c, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, build(c, manager, id));
    }

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.dropConfig(c, id);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!ACTION_SHIFT.equals(intent.getAction())) {
            super.onReceive(c, intent);
            return;
        }
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return;
        JSONObject cfg = WidgetStore.config(c, id);
        if (cfg == null) cfg = new JSONObject();
        int delta = intent.getIntExtra(EXTRA_DELTA, 0);
        try {
            cfg.put("shift", delta == 0 ? 0 : CalendarDays.clampShift(cfg.optInt("shift") + delta));
        } catch (JSONException e) {
            return;
        }
        WidgetStore.saveConfig(c, id, cfg);
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        manager.updateAppWidget(id, build(c, manager, id));
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : manager.getAppWidgetIds(new ComponentName(c, CalendarWidget.class))) {
            manager.updateAppWidget(id, build(c, manager, id));
        }
    }

    static String layoutOf(JSONObject cfg) {
        return cfg != null && MONTH.equals(WidgetStore.str(cfg, "layout")) ? MONTH : AGENDA;
    }

    static String sourceOf(JSONObject cfg) {
        return cfg != null && PHONE.equals(WidgetStore.str(cfg, "source")) ? PHONE : APP;
    }

    /** The app's words, in its language; English before it has sent any. */
    static String word(JSONObject cal, String key, String fallback) {
        JSONObject w = cal == null ? null : cal.optJSONObject("words");
        String s = w == null ? "" : WidgetStore.str(w, key);
        return s.isEmpty() ? fallback : s;
    }

    static Locale localeOf(JSONObject cal) {
        String lang = cal == null ? "" : WidgetStore.str(cal, "lang");
        return lang.isEmpty() ? Locale.getDefault() : Locale.forLanguageTag(lang);
    }

    static RemoteViews build(Context c, AppWidgetManager manager, int id) {
        JSONObject cfg = WidgetStore.config(c, id);
        JSONObject snap = WidgetStore.snapshot(c);
        JSONObject cal = snap == null ? null : snap.optJSONObject("calendar");
        boolean month = MONTH.equals(layoutOf(cfg));
        boolean phone = PHONE.equals(sourceOf(cfg));
        Locale locale = localeOf(cal);
        boolean rtl = cal != null ? cal.optBoolean("rtl") : android.text.TextUtils.getLayoutDirectionFromLocale(locale) == View.LAYOUT_DIRECTION_RTL;
        String today = WidgetStore.today();

        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_calendar);
        v.setInt(R.id.widget_root, "setLayoutDirection", rtl ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
        v.removeAllViews(R.id.cal_body);
        v.removeAllViews(R.id.cal_heads);

        String note = null;
        if (cal != null && cal.optBoolean("hidden")) note = word(cal, "locked", "Hidden while LifeLog is locked");
        else if (snap == null && !phone) note = "Open LifeLog once to bring your calendar here";
        else if (snap != null && cal == null && !phone) note = "Update LifeLog to bring your calendar here";

        Map<String, CalendarDays.Day> days = CalendarDays.fromSnapshot(note == null ? cal : null, !phone);
        if (note == null && phone) {
            int[] from = CalendarDays.shifted(today, -1), to = CalendarDays.shifted(today, 3);
            Map<String, List<CalendarDays.Item>> events = PhoneCalendar.read(c,
                CalendarDays.key(from[0], from[1]) + "-01", WidgetStore.addDays(CalendarDays.key(to[0], to[1]) + "-01", -1));
            if (events == null) note = word(cal, "allow", "Allow LifeLog to read your calendars in the widget's settings");
            else CalendarDays.addEvents(days, events);
        }

        WidgetSize size = WidgetSize.of(manager, id);
        int shift = month ? CalendarDays.clampShift(cfg == null ? 0 : cfg.optInt("shift")) : 0;
        int[] ym = CalendarDays.shifted(today, shift);
        Calendar now = WidgetStore.dayOf(today);
        if (month) {
            Calendar first = WidgetStore.dayOf(CalendarDays.key(ym[0], ym[1]) + "-01");
            v.setTextViewText(R.id.cal_title, new SimpleDateFormat("LLLL yyyy", locale).format(first.getTime()));
        } else {
            v.setTextViewText(R.id.cal_title, word(cal, "title", "Calendar"));
        }
        CalendarDays.Day todays = days.get(today);
        String sub = new SimpleDateFormat("EEE d MMM", locale).format(now.getTime());
        if (todays != null && note == null) sub += " · " + todays.total + " " + word(cal, "today", "today").toLowerCase(locale);
        v.setTextViewText(R.id.cal_sub, sub);
        v.setOnClickPendingIntent(R.id.cal_head, open(c, id, month && shift != 0 ? CalendarDays.key(ym[0], ym[1]) + "-01" : today));

        v.setViewVisibility(R.id.cal_prev, month ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.cal_next, month ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.cal_heads, month && note == null ? View.VISIBLE : View.GONE);
        if (month) {
            // The arrows point the way the months go, which turns with the page.
            v.setTextViewText(R.id.cal_prev, rtl ? "›" : "‹");
            v.setTextViewText(R.id.cal_next, rtl ? "‹" : "›");
            v.setOnClickPendingIntent(R.id.cal_prev, shiftIntent(c, id, -1));
            v.setOnClickPendingIntent(R.id.cal_next, shiftIntent(c, id, 1));
            v.setFloat(R.id.cal_prev, "setAlpha", shift > -1 ? 1f : 0.35f);
            v.setFloat(R.id.cal_next, "setAlpha", shift < 2 ? 1f : 0.35f);
        }

        if (note == null) {
            if (month) month(c, v, id, days, ym, today, cal, locale, size);
            else note = agenda(c, v, id, days, today, cal, locale, size);
        }
        v.setTextViewText(R.id.cal_note, note == null ? "" : note);
        v.setViewVisibility(R.id.cal_note, note == null ? View.GONE : View.VISIBLE);
        return v;
    }

    /** Returns what to say instead, or null. */
    private static String agenda(Context c, RemoteViews v, int id, Map<String, CalendarDays.Day> days, String today, JSONObject cal, Locale locale, WidgetSize size) {
        int max = size.height <= 0 ? 9 : Math.max(3, (size.height - HEAD_DP) / ROW_DP);
        SimpleDateFormat dayName = new SimpleDateFormat("EEE d", locale);
        String tomorrow = WidgetStore.addDays(today, 1);
        int accent = c.getResources().getColor(R.color.widget_accent, null);
        int muted = c.getResources().getColor(R.color.widget_muted, null);
        for (CalendarDays.Line line : CalendarDays.agenda(days, today, max)) {
            if (line.type == CalendarDays.HEAD) {
                RemoteViews h = new RemoteViews(c.getPackageName(), R.layout.widget_cal_day);
                String name = dayName.format(WidgetStore.dayOf(line.date).getTime());
                if (line.date.equals(today)) name = word(cal, "today", "Today") + " · " + name;
                else if (line.date.equals(tomorrow)) name = word(cal, "tomorrow", "Tomorrow") + " · " + name;
                h.setTextViewText(R.id.cal_day, name);
                if (line.date.equals(today)) h.setTextColor(R.id.cal_day, accent);
                h.setOnClickPendingIntent(R.id.cal_day, open(c, id, line.date));
                v.addView(R.id.cal_body, h);
            } else if (line.type == CalendarDays.ITEM) {
                RemoteViews r = new RemoteViews(c.getPackageName(), R.layout.widget_cal_row);
                CalendarDays.Item it = line.item;
                r.setImageViewResource(R.id.cal_mark, markOf(it.kind));
                r.setInt(R.id.cal_mark, "setColorFilter", colorOf(c, it));
                r.setTextViewText(R.id.cal_text, it.title);
                if (CalendarDays.DONE.equals(it.kind)) r.setTextColor(R.id.cal_text, muted);
                r.setTextViewText(R.id.cal_time, it.allDay ? word(cal, "allDay", "All day") : it.time);
                r.setOnClickPendingIntent(R.id.cal_row, open(c, id, line.date));
                v.addView(R.id.cal_body, r);
            } else {
                RemoteViews h = new RemoteViews(c.getPackageName(), R.layout.widget_cal_more);
                h.setTextViewText(R.id.cal_more, line.type == CalendarDays.MORE
                    ? CalendarDays.more(word(cal, "more", "{n} more"), line.count)
                    : word(cal, "nothing", "Nothing today"));
                h.setOnClickPendingIntent(R.id.cal_more, open(c, id, today));
                v.addView(R.id.cal_body, h);
            }
        }
        return null;
    }

    private static void month(Context c, RemoteViews v, int id, Map<String, CalendarDays.Day> days, int[] ym, String today, JSONObject cal, Locale locale, WidgetSize size) {
        int weekStart = cal == null ? Calendar.getInstance(locale).getFirstDayOfWeek() - Calendar.SUNDAY : cal.optInt("weekStart");
        List<String> cells = CalendarDays.monthCells(ym[0], ym[1], weekStart);
        SimpleDateFormat letter = new SimpleDateFormat("EEEEE", locale);
        for (int i = 0; i < 7; i++) {
            RemoteViews w = new RemoteViews(c.getPackageName(), R.layout.widget_cal_weekday);
            w.setTextViewText(R.id.cal_weekday, letter.format(WidgetStore.dayOf(cells.get(i)).getTime()));
            v.addView(R.id.cal_heads, w);
        }
        String key = CalendarDays.key(ym[0], ym[1]);
        int text = c.getResources().getColor(R.color.widget_text, null);
        int muted = c.getResources().getColor(R.color.widget_muted, null);
        int white = c.getResources().getColor(R.color.widget_on_accent, null);
        for (int w = 0; w < cells.size() / 7; w++) {
            RemoteViews week = new RemoteViews(c.getPackageName(), R.layout.widget_cal_week);
            for (int i = 0; i < 7; i++) {
                String date = cells.get(w * 7 + i);
                boolean inMonth = date.startsWith(key);
                RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.widget_cal_cell);
                cell.setTextViewText(R.id.cal_num, String.valueOf(Integer.parseInt(date.substring(8))));
                if (date.equals(today)) {
                    cell.setInt(R.id.cal_num, "setBackgroundResource", R.drawable.widget_cal_today);
                    cell.setTextColor(R.id.cal_num, white);
                } else {
                    cell.setTextColor(R.id.cal_num, inMonth ? text : muted);
                    if (!inMonth) cell.setFloat(R.id.cal_num, "setAlpha", 0.5f);
                }
                cell.setTextViewText(R.id.cal_marks, inMonth ? marks(c, days.get(date)) : " ");
                cell.setOnClickPendingIntent(R.id.cal_cell, open(c, id, date));
                week.addView(R.id.cal_week, cell);
            }
            v.addView(R.id.cal_body, week);
        }
    }

    /** A day's marks as coloured glyphs: ▬ an event, ○ a task, □ a release, ● something finished. */
    private static CharSequence marks(Context c, CalendarDays.Day day) {
        List<CalendarDays.Item> list = CalendarDays.marks(day, MARKS);
        if (list.isEmpty()) return " ";
        SpannableStringBuilder s = new SpannableStringBuilder();
        for (CalendarDays.Item it : list) {
            String glyph = CalendarDays.EVENT.equals(it.kind) ? "▬" : CalendarDays.TASK.equals(it.kind) ? "○" : CalendarDays.RELEASE.equals(it.kind) ? "□" : "●";
            int at = s.length();
            s.append(glyph);
            s.setSpan(new ForegroundColorSpan(colorOf(c, it)), at, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return s;
    }

    private static int markOf(String kind) {
        if (CalendarDays.EVENT.equals(kind)) return R.drawable.widget_cal_bar;
        if (CalendarDays.TASK.equals(kind)) return R.drawable.widget_cal_ring;
        if (CalendarDays.RELEASE.equals(kind)) return R.drawable.widget_cal_dash;
        return R.drawable.widget_cal_dot;
    }

    private static int colorOf(Context c, CalendarDays.Item it) {
        if (CalendarDays.TASK.equals(it.kind)) {
            return it.priority > 0 ? ListService.priorityColor(c, it.priority) : c.getResources().getColor(R.color.widget_accent, null);
        }
        return WidgetStore.parseColor(it.color, c.getResources().getColor(R.color.widget_muted, null));
    }

    /** The app, on that day of the Timeline's calendar. One per day, told apart by its data. */
    private static PendingIntent open(Context c, int id, String date) {
        return WidgetStore.openAppOn(c, "open-calendar:" + date, 440, Uri.parse("lifelog-calendar://" + id + "/" + date));
    }

    private static PendingIntent shiftIntent(Context c, int id, int delta) {
        Intent i = new Intent(c, CalendarWidget.class).setAction(ACTION_SHIFT)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .putExtra(EXTRA_DELTA, delta)
            .setData(Uri.parse("lifelog-calendar-shift://" + id + "/" + delta));
        return PendingIntent.getBroadcast(c, 441, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
