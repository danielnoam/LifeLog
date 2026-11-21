package io.github.danielnoam.lifelog.widgets;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What the Calendar widget (Nov 2026) shows, worked out without Android, so
 * it runs in WidgetLogicTest. The app sends each day's items (widgets.js
 * calendarDays: Google events, tasks, releases, finished entries); set to
 * the phone's calendars, the widget drops the app's events and puts the
 * phone's in their place (PhoneCalendar). The agenda and the month grid
 * both read the days from here.
 */
final class CalendarDays {
    private CalendarDays() {}

    static final String EVENT = "event", TASK = "task", RELEASE = "release", DONE = "done";

    static final class Item {
        final String kind, title, time, color;
        final boolean allDay;
        final int priority;

        Item(String kind, String title, String time, String color, boolean allDay, int priority) {
            this.kind = kind;
            this.title = title;
            this.time = time == null ? "" : time;
            this.color = color == null ? "" : color;
            this.allDay = allDay;
            this.priority = priority;
        }

        String rank() {
            return allDay ? "0" : !time.isEmpty() ? "1" + time : "2";
        }
    }

    static final class Day {
        final List<Item> items = new ArrayList<>();
        /** How many the day has, including any the app didn't send. */
        int total;

        void sort() {
            List<Item> was = new ArrayList<>(items);
            Collections.sort(items, (a, b) -> {
                int r = a.rank().compareTo(b.rank());
                return r != 0 ? r : was.indexOf(a) - was.indexOf(b);
            });
        }
    }

    /** The snapshot's days; without the app's events when the phone's stand in for them. */
    static Map<String, Day> fromSnapshot(JSONObject cal, boolean appEvents) {
        Map<String, Day> out = new HashMap<>();
        JSONObject days = cal == null ? null : cal.optJSONObject("days");
        if (days == null) return out;
        JSONArray names = days.names();
        for (int i = 0; names != null && i < names.length(); i++) {
            String date = names.optString(i);
            JSONObject d = days.optJSONObject(date);
            JSONArray items = d == null ? null : d.optJSONArray("items");
            if (items == null) continue;
            Day day = new Day();
            int dropped = 0;
            for (int j = 0; j < items.length(); j++) {
                JSONObject x = items.optJSONObject(j);
                if (x == null) continue;
                String kind = WidgetStore.str(x, "k");
                if (EVENT.equals(kind) && !appEvents) {
                    dropped++;
                    continue;
                }
                day.items.add(new Item(kind, WidgetStore.str(x, "t"), WidgetStore.str(x, "time"), WidgetStore.str(x, "c"), x.optBoolean("all"), x.optInt("p")));
            }
            day.total = Math.max(day.items.size(), d.optInt("n", items.length()) - dropped);
            if (!day.items.isEmpty()) out.put(date, day);
        }
        return out;
    }

    /** The phone's events, joined to the app's items, in order. */
    static void addEvents(Map<String, Day> days, Map<String, List<Item>> events) {
        if (events == null) return;
        for (Map.Entry<String, List<Item>> e : events.entrySet()) {
            Day day = days.get(e.getKey());
            if (day == null) {
                day = new Day();
                days.put(e.getKey(), day);
            }
            day.items.addAll(0, e.getValue());
            day.total += e.getValue().size();
            day.sort();
        }
    }

    // ---- the agenda ----

    static final int HEAD = 0, ITEM = 1, NOTHING = 2, MORE = 3;
    /** How far ahead the agenda looks. */
    static final int HORIZON = 14;

    static final class Line {
        final int type;
        final String date;
        final Item item;
        final int count;

        Line(int type, String date, Item item, int count) {
            this.type = type;
            this.date = date;
            this.item = item;
            this.count = count;
        }
    }

    /**
     * Today and the days after it that have anything, as headings and rows,
     * in at most `max` lines (three or more). Today always has its heading,
     * with "Nothing today" under it when empty. What doesn't fit is one "N
     * more" line; a later day's heading never shows without a row of its own.
     */
    static List<Line> agenda(Map<String, Day> days, String today, int max) {
        List<Line> out = new ArrayList<>();
        max = Math.max(3, max);
        int hidden = 0;
        boolean full = false;
        for (int i = 0; i < HORIZON; i++) {
            String date = WidgetStore.addDays(today, i);
            Day day = days.get(date);
            if (day == null && i > 0) continue;
            int total = day == null ? 0 : day.total;
            if (full || (i > 0 && max - out.size() < 2)) {
                full = true;
                hidden += total;
                continue;
            }
            out.add(new Line(HEAD, date, null, 0));
            if (day == null) {
                out.add(new Line(NOTHING, date, null, 0));
                continue;
            }
            int shown = 0;
            for (Item it : day.items) {
                if (out.size() >= max) break;
                out.add(new Line(ITEM, date, it, 0));
                shown++;
            }
            hidden += total - shown;
            if (shown < total) full = true;
        }
        if (hidden > 0 && out.size() >= max) {
            if (out.remove(out.size() - 1).type == ITEM) hidden++;
            if (out.size() > 1 && out.get(out.size() - 1).type == HEAD) out.remove(out.size() - 1);
        }
        if (hidden > 0) out.add(new Line(MORE, null, null, hidden));
        return out;
    }

    /** Whether anything at all is on in the next fortnight. */
    static boolean anyAhead(Map<String, Day> days, String today) {
        for (int i = 0; i < HORIZON; i++) if (days.containsKey(WidgetStore.addDays(today, i))) return true;
        return false;
    }

    // ---- the month ----

    /** The yyyy-MM-dd of every cell, whole weeks from the one the 1st is in, starting on `weekStart` (0 = Sunday). */
    static List<String> monthCells(int year, int month, int weekStart) {
        Calendar first = Calendar.getInstance();
        first.clear();
        first.set(year, month - 1, 1);
        int weekday = first.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
        int lead = ((weekday - weekStart) % 7 + 7) % 7;
        int length = first.getActualMaximum(Calendar.DAY_OF_MONTH);
        int weeks = (lead + length + 6) / 7;
        String start = WidgetStore.addDays(key(year, month) + "-01", -lead);
        List<String> out = new ArrayList<>();
        for (int i = 0; i < weeks * 7; i++) out.add(WidgetStore.addDays(start, i));
        return out;
    }

    static String key(int year, int month) {
        return year + "-" + (month < 10 ? "0" : "") + month;
    }

    /** The month `shift` months from today's: { year, month }. */
    static int[] shifted(String today, int shift) {
        int y = Integer.parseInt(today.substring(0, 4)), m = Integer.parseInt(today.substring(5, 7)) - 1 + shift;
        y += Math.floorDiv(m, 12);
        m = Math.floorMod(m, 12) + 1;
        return new int[] { y, m };
    }

    /** The app sends last month to the month after next; the arrows stay inside it. */
    static int clampShift(int shift) {
        return Math.max(-1, Math.min(2, shift));
    }

    /** A day's marks in the month grid: kinds in the order they show, at most `max`. */
    static List<Item> marks(Day day, int max) {
        List<Item> out = new ArrayList<>();
        if (day == null) return out;
        for (Item it : day.items) {
            if (out.size() >= max) break;
            out.add(it);
        }
        return out;
    }

    /** "{n} more" in the app's words, or English before the app has sent them. */
    static String more(String template, int n) {
        String t = template == null || !template.contains("{n}") ? "{n} more" : template;
        return t.replace("{n}", String.valueOf(n));
    }
}
