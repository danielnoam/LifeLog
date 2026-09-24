package io.github.danielnoam.lifelog.widgets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The parts of the widgets and reminders that decide something, run on the
 * JVM in CI (`gradlew :lifelog-widgets:testDebugUnitTest`). Everything here
 * happens on the phone with the app closed, where no browser test can reach.
 * 2026-09-24 is a Thursday.
 */
public class WidgetLogicTest {

    private static final String D = "2026-09-24";
    private static final JSONArray NONE = new JSONArray();

    private static JSONObject json(String s) throws Exception {
        return new JSONObject(s);
    }

    private static long at(String when) throws Exception {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).parse(when).getTime();
    }

    private static String show(long t) {
        return t < 0 ? "none" : new SimpleDateFormat("EEE yyyy-MM-dd HH:mm", Locale.US).format(new Date(t));
    }

    private static JSONObject daily() throws Exception {
        return json("{\"id\":\"h\",\"startedAt\":\"2026-01-01\",\"target\":1,\"runBefore\":5,\"marks\":{},\"remind\":\"21:00\"}");
    }

    private static JSONArray ticked(String date) throws Exception {
        return new JSONArray("[{\"kind\":\"habit\",\"id\":\"h\",\"date\":\"" + date + "\",\"value\":1}]");
    }

    // ---- due ----

    @Test
    public void aNullStartDateIsNoStartDateNotTheWordNull() throws Exception {
        // org.json reads a JSON null as "null", which sorts after every date.
        assertTrue(WidgetStore.dueOn(json("{\"startedAt\":null}"), D));
        assertFalse(WidgetStore.dueOn(json("{\"startedAt\":\"2026-10-01\"}"), D));
    }

    @Test
    public void certainDaysAreDueOnThoseDaysOnly() throws Exception {
        JSONObject tueThu = json("{\"days\":[2,4]}");
        assertTrue(WidgetStore.dueOn(tueThu, D));
        assertFalse(WidgetStore.dueOn(tueThu, "2026-09-25"));
    }

    // ---- streaks, as habits.js's streakOf counts them ----

    @Test
    public void todayNotYetKeptDoesNotCountAgainstTheRun() throws Exception {
        assertEquals(5, WidgetStore.streakOn(daily(), NONE, D, D));
    }

    @Test
    public void keptOnTheWidgetTodayAddsOne() throws Exception {
        assertEquals(6, WidgetStore.streakOn(daily(), ticked(D), D, D));
    }

    @Test
    public void theNextMorningWithoutTheAppYesterdaysWidgetTickStillCounts() throws Exception {
        assertEquals(6, WidgetStore.streakOn(daily(), ticked(D), D, "2026-09-25"));
    }

    @Test
    public void theNextMorningAfterAMissedDayTheRunIsGone() throws Exception {
        assertEquals(0, WidgetStore.streakOn(daily(), NONE, D, "2026-09-25"));
    }

    @Test
    public void aWeekendDoesNotBreakAWeekdaysHabit() throws Exception {
        JSONObject weekdays = json("{\"id\":\"w\",\"startedAt\":\"2026-01-01\",\"days\":[1,2,3,4,5],\"runBefore\":3,\"marks\":{\"2026-09-25\":1}}");
        // Three before Friday, Friday kept; Monday isn't over yet.
        assertEquals(4, WidgetStore.streakOn(weekdays, NONE, "2026-09-25", "2026-09-28"));
    }

    @Test
    public void aCountedHabitPartWayThroughIsNotKeptYet() throws Exception {
        JSONObject counted = json("{\"id\":\"c\",\"startedAt\":\"2026-01-01\",\"target\":3,\"runBefore\":2,\"marks\":{\"" + D + "\":2}}");
        assertEquals(2, WidgetStore.streakOn(counted, NONE, D, D));
    }

    // ---- the next reminder ----

    private static JSONObject only(JSONObject h) throws Exception {
        return new JSONObject().put("habits", new JSONArray().put(h));
    }

    @Test
    public void beforeTonightsTimeItIsTonight() throws Exception {
        assertEquals("Thu 2026-09-24 21:00", show(Reminders.next(only(daily()), D, at(D + " 20:00"))));
    }

    @Test
    public void afterTonightsTimeItIsTomorrow() throws Exception {
        assertEquals("Fri 2026-09-25 21:00", show(Reminders.next(only(daily()), D, at(D + " 22:00"))));
    }

    @Test
    public void aMondaysHabitIsRemindedOnMonday() throws Exception {
        JSONObject mondays = json("{\"id\":\"m\",\"startedAt\":\"2026-01-01\",\"days\":[1],\"remind\":\"07:30\"}");
        assertEquals("Mon 2026-09-28 07:30", show(Reminders.next(only(mondays), D, at(D + " 08:00"))));
    }

    @Test
    public void noTimeNoAlarm() throws Exception {
        assertEquals("none", show(Reminders.next(only(json("{\"id\":\"n\",\"remind\":\"\"}")), D, 0)));
        assertEquals("none", show(Reminders.next(only(json("{\"id\":\"n\",\"remind\":null}")), D, 0)));
    }

    @Test
    public void notBeforeTheHabitStarts() throws Exception {
        JSONObject later = json("{\"id\":\"l\",\"startedAt\":\"2026-10-01\",\"remind\":\"09:00\"}");
        assertEquals("Thu 2026-10-01 09:00", show(Reminders.next(only(later), D, at(D + " 10:00"))));
    }

    @Test
    public void theReminderSaysWhatIsAtStake() throws Exception {
        JSONObject snap = new JSONObject().put("today", D).put("habits", new JSONArray().put(daily()));
        WidgetStore.Row r = WidgetStore.habitRows(snap, NONE, D).get(0);
        assertEquals("21:00", r.remind);
        assertEquals("Still to do today — keep your 5-day streak going", Reminders.text(r));
    }

    // ---- the to-do list, as the app's panels ----

    private static String rows(JSONObject snap, JSONArray q) {
        List<String> out = new ArrayList<>();
        for (WidgetStore.Row r : WidgetStore.todoRows(snap, q)) {
            if (r.type == WidgetStore.ROW_HEADER) out.add("[" + r.text + "]");
            else if (r.type == WidgetStore.ROW_SEP) out.add("--" + r.text + "--");
            else out.add((r.done ? "x:" : "o:") + r.id);
        }
        return String.join(" ", out);
    }

    private static JSONObject todos() throws Exception {
        return json("{\"todos\":["
            + "{\"id\":\"t2\",\"text\":\"Call\",\"category\":\"\",\"color\":\"\",\"done\":false},"
            + "{\"id\":\"t7\",\"text\":\"Bins\",\"category\":\"\",\"color\":\"\",\"done\":false},"
            + "{\"id\":\"t3\",\"text\":\"Old\",\"category\":\"\",\"color\":\"\",\"done\":true},"
            + "{\"id\":\"t4\",\"text\":\"Taxes\",\"category\":\"Work\",\"color\":\"#ff0000\",\"done\":false},"
            + "{\"id\":\"t9\",\"text\":\"Filed\",\"category\":\"Work\",\"color\":\"#ff0000\",\"done\":true}"
            + "],\"doneCount\":{\"\":1,\"Work\":1}}");
    }

    @Test
    public void everyPanelWithItsFinishedOnesUnderALine() throws Exception {
        assertEquals("[To do] o:t2 o:t7 --1 done-- x:t3 [Work] o:t4 --1 done-- x:t9", rows(todos(), NONE));
    }

    @Test
    public void tickedOnTheWidgetJoinsTheTopOfTheFinishedOnesLatestFirst() throws Exception {
        JSONArray q = new JSONArray("[{\"kind\":\"todo\",\"id\":\"t2\",\"done\":true},{\"kind\":\"todo\",\"id\":\"t7\",\"done\":true}]");
        assertEquals("[To do] --3 done-- x:t7 x:t2 x:t3 [Work] o:t4 --1 done-- x:t9", rows(todos(), q));
    }

    @Test
    public void untickingThePanelsOnlyFinishedOneTakesTheLineWithIt() throws Exception {
        JSONArray q = new JSONArray("[{\"kind\":\"todo\",\"id\":\"t9\",\"done\":false}]");
        assertEquals("[To do] o:t2 o:t7 --1 done-- x:t3 [Work] o:t4 o:t9", rows(todos(), q));
    }

    @Test
    public void aLoneGeneralListNeedsNoHeading() throws Exception {
        assertEquals("o:a", rows(json("{\"todos\":[{\"id\":\"a\",\"text\":\"A\",\"category\":\"\",\"color\":\"\"}]}"), NONE));
    }
}
