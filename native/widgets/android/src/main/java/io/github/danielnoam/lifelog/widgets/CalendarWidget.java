package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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
 * and what was finished each day, as a month whose weeks fill the widget,
 * each day with as many chips as its height holds (Nov 2026, laid out like
 * Google Calendar's month widget; the agenda layout it started with is
 * gone). In its settings (CalendarSettingsActivity) the events can come
 * from the phone's own calendars instead of LifeLog's Google connection
 * (PhoneCalendar): always current, every account on the phone, no app run
 * needed, at the cost of the calendar permission. Week numbers can be
 * turned off there too.
 *
 * Words come from the app (widgets.js calendarSnapshot), in its language,
 * and the layout turns right to left with it. A day's tap opens the app on
 * that day of the Timeline's calendar; the arrows step through the months
 * the app sent, here on the home screen; "+" opens the quick-add window.
 */
public class CalendarWidget extends AppWidgetProvider {

    static final String ACTION_SHIFT = "io.github.danielnoam.lifelog.widgets.CALENDAR_SHIFT";
    static final String EXTRA_DELTA = "delta";
    static final String APP = "app", PHONE = "phone";

    // The month's measures, in dp, as its layouts have them: the head, the
    // weekday letters' row, the space under the weeks, a week's line and
    // day number, a chip with its gap, and the "+N" line.
    private static final int HEAD_DP = 56, LETTERS_DP = 26, BOTTOM_DP = 4, NUM_DP = 23, CHIP_DP = 15, MORE_DP = 13;
    /** Room a day has before the launcher has said how tall the widget is. */
    private static final int ROOMY_DP = 3 * CHIP_DP;

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

    /** Week numbers beside the month: on unless the widget's settings turned them off. */
    static boolean weekNumbersOf(JSONObject cfg) {
        return cfg == null || cfg.optBoolean("weekNumbers", true);
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
        int shift = CalendarDays.clampShift(cfg == null ? 0 : cfg.optInt("shift"));
        int[] ym = CalendarDays.shifted(today, shift);
        Calendar now = WidgetStore.dayOf(today);
        // The month's name alone, as a wall calendar has it; the year only
        // when it isn't this one.
        Calendar first = WidgetStore.dayOf(CalendarDays.key(ym[0], ym[1]) + "-01");
        String pattern = ym[0] == now.get(Calendar.YEAR) ? "LLLL" : "LLLL yyyy";
        v.setTextViewText(R.id.cal_title, new SimpleDateFormat(pattern, locale).format(first.getTime()));
        v.setOnClickPendingIntent(R.id.cal_title, open(c, id, shift != 0 ? CalendarDays.key(ym[0], ym[1]) + "-01" : today));

        // The arrows point the way the months go, which turns with the page.
        v.setImageViewResource(R.id.cal_prev, rtl ? R.drawable.widget_ico_chevron_right : R.drawable.widget_ico_chevron_left);
        v.setImageViewResource(R.id.cal_next, rtl ? R.drawable.widget_ico_chevron_left : R.drawable.widget_ico_chevron_right);
        v.setOnClickPendingIntent(R.id.cal_prev, shiftIntent(c, id, -1));
        v.setOnClickPendingIntent(R.id.cal_next, shiftIntent(c, id, 1));
        v.setInt(R.id.cal_prev, "setImageAlpha", shift > -1 ? 255 : 90);
        v.setInt(R.id.cal_next, "setImageAlpha", shift < 2 ? 255 : 90);
        v.setContentDescription(R.id.cal_prev, word(cal, "prevMonth", "Previous month"));
        v.setContentDescription(R.id.cal_next, word(cal, "nextMonth", "Next month"));
        // The quick-add window, on an entry: the kind of thing that lands on
        // the calendar on the day it's given. Its tabs switch kinds.
        v.setOnClickPendingIntent(R.id.cal_add, WidgetStore.addButton(c, "add-entry", 442, Uri.parse("lifelog-calendar-add://" + id), false));
        v.setContentDescription(R.id.cal_add, word(cal, "add", "Add"));

        v.setViewVisibility(R.id.cal_heads, note == null ? View.VISIBLE : View.GONE);
        if (note == null) month(c, v, id, days, ym, today, cal, locale, size, weekNumbersOf(cfg));
        v.setTextViewText(R.id.cal_note, note == null ? "" : note);
        v.setViewVisibility(R.id.cal_note, note == null ? View.GONE : View.VISIBLE);
        return v;
    }

    private static void month(Context c, RemoteViews v, int id, Map<String, CalendarDays.Day> days, int[] ym, String today, JSONObject cal, Locale locale, WidgetSize size, boolean weekNumbers) {
        int weekStart = cal == null ? Calendar.getInstance(locale).getFirstDayOfWeek() - Calendar.SUNDAY : cal.optInt("weekStart");
        List<String> cells = CalendarDays.monthCells(ym[0], ym[1], weekStart);
        int weeks = cells.size() / 7;
        SimpleDateFormat letter = new SimpleDateFormat("EEEEE", locale);
        if (weekNumbers) v.addView(R.id.cal_heads, new RemoteViews(c.getPackageName(), R.layout.widget_cal_week_gap));
        for (int i = 0; i < 7; i++) {
            RemoteViews w = new RemoteViews(c.getPackageName(), R.layout.widget_cal_weekday);
            w.setTextViewText(R.id.cal_weekday, letter.format(WidgetStore.dayOf(cells.get(i)).getTime()));
            v.addView(R.id.cal_heads, w);
        }
        // What a day has room for: the weeks share the height under the head.
        int room = size.height <= 0 ? ROOMY_DP : (size.height - HEAD_DP - LETTERS_DP - BOTTOM_DP) / weeks - NUM_DP;
        String key = CalendarDays.key(ym[0], ym[1]);
        int text = c.getResources().getColor(R.color.widget_text, null);
        int white = c.getResources().getColor(R.color.widget_on_accent, null);
        for (int w = 0; w < weeks; w++) {
            RemoteViews week = new RemoteViews(c.getPackageName(), R.layout.widget_cal_week);
            if (weekNumbers) {
                RemoteViews n = new RemoteViews(c.getPackageName(), R.layout.widget_cal_week_num);
                n.setTextViewText(R.id.cal_week_num, String.valueOf(CalendarDays.weekNumber(cells.get(w * 7))));
                week.addView(R.id.cal_week, n);
            }
            for (int i = 0; i < 7; i++) {
                String date = cells.get(w * 7 + i);
                boolean inMonth = date.startsWith(key);
                RemoteViews cell = new RemoteViews(c.getPackageName(), R.layout.widget_cal_cell);
                if (i == 0) cell.setViewVisibility(R.id.cal_line, View.GONE);
                cell.setTextViewText(R.id.cal_num, String.valueOf(Integer.parseInt(date.substring(8))));
                if (date.equals(today)) {
                    cell.setInt(R.id.cal_num, "setBackgroundResource", R.drawable.widget_cal_today);
                    cell.setTextColor(R.id.cal_num, white);
                } else {
                    cell.setTextColor(R.id.cal_num, text);
                    if (!inMonth) cell.setFloat(R.id.cal_num, "setAlpha", 0.45f);
                }
                chips(c, cell, days.get(date), room, !inMonth);
                cell.setOnClickPendingIntent(R.id.cal_cell, open(c, id, date));
                week.addView(R.id.cal_week, cell);
            }
            v.addView(R.id.cal_body, week);
        }
    }

    /** A day's things as chips, as many as its room holds, then "+N" for the rest. */
    private static void chips(Context c, RemoteViews cell, CalendarDays.Day day, int room, boolean faded) {
        if (day == null) return;
        int shown = CalendarDays.chipsShown(day.total, day.items.size(), room, CHIP_DP, MORE_DP);
        for (int i = 0; i < shown; i++) {
            CalendarDays.Item it = day.items.get(i);
            int color = colorOf(c, it);
            boolean filled = CalendarDays.EVENT.equals(it.kind) || CalendarDays.DONE.equals(it.kind);
            RemoteViews chip = new RemoteViews(c.getPackageName(), R.layout.widget_cal_chip);
            chip.setImageViewResource(R.id.cal_chip_bg, CalendarDays.TASK.equals(it.kind) ? R.drawable.widget_cal_chip_line
                : CalendarDays.RELEASE.equals(it.kind) ? R.drawable.widget_cal_chip_dash : R.drawable.widget_cal_chip_fill);
            chip.setInt(R.id.cal_chip_bg, "setColorFilter", color);
            chip.setTextViewText(R.id.cal_chip_text, it.title);
            chip.setTextColor(R.id.cal_chip_text, filled ? (CalendarDays.light(color) ? 0xFF1B1F27 : 0xFFFFFFFF) : color);
            if (CalendarDays.DONE.equals(it.kind) || faded) chip.setFloat(R.id.cal_chip, "setAlpha", 0.55f);
            cell.addView(R.id.cal_chips, chip);
        }
        if (shown < day.total) {
            RemoteViews more = new RemoteViews(c.getPackageName(), R.layout.widget_cal_chip_more);
            more.setTextViewText(R.id.cal_chip_more, "+" + (day.total - shown));
            cell.addView(R.id.cal_chips, more);
        }
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
