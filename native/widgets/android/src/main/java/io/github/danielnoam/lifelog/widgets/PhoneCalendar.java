package io.github.danielnoam.lifelog.widgets;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * The phone's own calendars (Nov 2026), for a Calendar widget set to them:
 * every account synced to the phone (Google, Outlook, Samsung…), read
 * straight from Android's calendar store, so it's as fresh as the phone is
 * and needs no network. Read here and drawn, never stored or sent to the
 * app. Needs READ_CALENDAR, asked for in the widget's settings only.
 */
final class PhoneCalendar {
    private PhoneCalendar() {}

    private static final String[] COLUMNS = {
        CalendarContract.Instances.TITLE,
        CalendarContract.Instances.BEGIN,
        CalendarContract.Instances.END,
        CalendarContract.Instances.ALL_DAY,
        CalendarContract.Instances.DISPLAY_COLOR,
    };

    static boolean allowed(Context c) {
        return c.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    /** Each day from `from` to `to` (yyyy-MM-dd, both included) → its events; null without the permission. */
    static Map<String, List<CalendarDays.Item>> read(Context c, String from, String to) {
        if (!allowed(c)) return null;
        Calendar start = WidgetStore.dayOf(from), end = WidgetStore.dayOf(WidgetStore.addDays(to, 1));
        if (start == null || end == null) return null;
        Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, start.getTimeInMillis());
        ContentUris.appendId(b, end.getTimeInMillis());
        Map<String, List<CalendarDays.Item>> out = new HashMap<>();
        SimpleDateFormat local = format("yyyy-MM-dd", TimeZone.getDefault());
        SimpleDateFormat utc = format("yyyy-MM-dd", TimeZone.getTimeZone("UTC"));
        SimpleDateFormat clock = format("HH:mm", TimeZone.getDefault());
        try (Cursor cur = c.getContentResolver().query(b.build(), COLUMNS,
                CalendarContract.Instances.VISIBLE + " = 1", null, CalendarContract.Instances.BEGIN + " ASC")) {
            while (cur != null && cur.moveToNext()) {
                String title = cur.getString(0);
                long begin = cur.getLong(1), finish = cur.isNull(2) ? begin : cur.getLong(2);
                boolean allDay = cur.getInt(3) == 1;
                String color = cur.isNull(4) ? "" : String.format(Locale.US, "#%06X", cur.getInt(4) & 0xFFFFFF);
                // An all-day event is kept in UTC midnights, its end the
                // day after; a timed one ending on midnight belongs to the day before.
                SimpleDateFormat days = allDay ? utc : local;
                String first = days.format(begin), last = days.format(Math.max(begin, finish - 1));
                String time = allDay ? "" : clock.format(begin);
                String day = first;
                for (int i = 0; day.compareTo(last) <= 0 && i < 62; i++, day = WidgetStore.addDays(day, 1)) {
                    if (day.compareTo(from) < 0 || day.compareTo(to) > 0) continue;
                    List<CalendarDays.Item> list = out.get(day);
                    if (list == null) {
                        list = new ArrayList<>();
                        out.put(day, list);
                    }
                    list.add(new CalendarDays.Item(CalendarDays.EVENT, title == null || title.trim().isEmpty() ? "—" : title.trim(),
                        day.equals(first) ? time : "", color, allDay, 0));
                }
            }
        } catch (RuntimeException e) {
            // Taken away meanwhile, or no calendar store on this phone.
            return null;
        }
        return out;
    }

    private static SimpleDateFormat format(String pattern, TimeZone zone) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
        f.setTimeZone(zone);
        return f;
    }
}
