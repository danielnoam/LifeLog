package io.github.danielnoam.lifelog.widgets;

import static org.junit.Assert.assertArrayEquals;
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

    // ---- how many habit rows fit ----

    @Test
    public void rowsAreFittedToTheWidgetsHeight() {
        assertEquals(1, HabitsWidget.rowsThatFit(110));  // the smallest it can be
        assertEquals(3, HabitsWidget.rowsThatFit(210));
        assertEquals(3, HabitsWidget.rowsThatFit(0));    // a launcher that doesn't say
        assertEquals(1, HabitsWidget.rowsThatFit(40));   // never none
    }

    // ---- small widgets get layouts of their own (0.189.0) ----

    @Test
    public void habitsTurnIntoAGridWhenNarrowOrShort() {
        assertFalse(HabitsWidget.compact(250, 200));  // three by two: the list
        assertTrue(HabitsWidget.compact(150, 200));   // two cells wide
        assertTrue(HabitsWidget.compact(250, 110));   // one row of list is no list
        assertFalse(HabitsWidget.compact(0, 0));      // a launcher that doesn't say
    }

    @Test
    public void theGridFitsItsTicksAndDropsNamesThenStreaksAsItShrinks() {
        assertEquals(2, HabitsWidget.chipDetail(100));
        assertEquals(1, HabitsWidget.chipDetail(70));
        assertEquals(0, HabitsWidget.chipDetail(50));
        assertArrayEquals(new int[] { 2, 1 }, HabitsWidget.chipGrid(140, 100));
        assertArrayEquals(new int[] { 4, 2 }, HabitsWidget.chipGrid(250, 160));
        assertArrayEquals(new int[] { 1, 1 }, HabitsWidget.chipGrid(40, 40));  // never none
    }

    @Test
    public void aTickShowsItsHabitsFirstLetter() {
        assertEquals("R", HabitsWidget.initial("  read"));
        assertEquals("💧", HabitsWidget.initial("💧 water"));
        assertEquals("•", HabitsWidget.initial(""));
    }

    @Test
    public void theToDoListLosesItsHeaderWhenSmall() {
        assertFalse(TodosWidget.compact(250, 250));
        assertTrue(TodosWidget.compact(150, 250));
        assertTrue(TodosWidget.compact(250, 110));
        assertFalse(TodosWidget.compact(0, 0));
    }

    @Test
    public void quickAddButtonsAreIconsWhenTheirLabelsWouldBeCut() {
        assertFalse(QuickAddWidget.iconsOnly(320, 5));
        assertTrue(QuickAddWidget.iconsOnly(180, 5));
        assertFalse(QuickAddWidget.iconsOnly(200, 3));  // tabs turned off leave room
        assertFalse(QuickAddWidget.iconsOnly(0, 5));
    }

    @Test
    public void spendingShedsItsCategoriesThenTheComparison() {
        assertEquals(SpendWidget.DETAIL_CATS, SpendWidget.detail(200));
        assertEquals(SpendWidget.DETAIL_COMPARE, SpendWidget.detail(120));
        assertEquals(SpendWidget.DETAIL_TOTAL, SpendWidget.detail(70));
        assertEquals(SpendWidget.DETAIL_CATS, SpendWidget.detail(0));
    }

    // ---- the spend widget ----

    @Test
    public void spendingFromAMonthThatHasEndedIsSaidToBeSo() {
        assertFalse(SpendWidget.stale("2026-09", "2026-09-30"));
        assertTrue(SpendWidget.stale("2026-09", "2026-10-01"));
        assertTrue(SpendWidget.stale("", D));
    }

    // ---- the to-do list's ids, which keep its place (Android 12+) ----

    @Test
    public void aToDoKeepsItsIdWhereverItMovesAndPanelsKeepTheirs() throws Exception {
        List<WidgetStore.Row> rows = WidgetStore.todoRows(todos(), NONE);
        WidgetStore.Row t2 = null;
        for (WidgetStore.Row r : rows) if ("t2".equals(r.id)) t2 = r;
        long before = TodosWidget.itemId(t2, "To do");
        // Ticked, it moves under the line; its id doesn't change.
        JSONArray q = new JSONArray("[{\"kind\":\"todo\",\"id\":\"t2\",\"done\":true}]");
        for (WidgetStore.Row r : WidgetStore.todoRows(todos(), q)) if ("t2".equals(r.id)) assertEquals(before, TodosWidget.itemId(r, "To do"));
        // Two panels' "done" lines are different items.
        WidgetStore.Row sep = new WidgetStore.Row();
        sep.type = WidgetStore.ROW_SEP;
        assertTrue(TodosWidget.itemId(sep, "To do") != TodosWidget.itemId(sep, "Work"));
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

    // ---- notes ----

    @Test
    public void aNoteCardShedsItsHeaderAndFitsItsLinesToTheHeight() {
        assertFalse(NoteCard.compact(0, 0));
        assertTrue(NoteCard.compact(250, 90));
        assertTrue(NoteCard.compact(120, 200));
        assertEquals(8, NoteCard.lines(0, false, 1));
        assertTrue(NoteCard.lines(300, false, 0) > NoteCard.lines(300, false, 2));
        assertEquals(1, NoteCard.lines(40, true, 0));
    }

    @Test
    public void aListIsItsTitleAndWhatsLeftOnIt() throws Exception {
        assertEquals("Shop\n• Milk\n• Eggs\n+3 more",
            NoteCard.body(json("{\"kind\":\"list\",\"text\":\"Shop\",\"items\":[\"Milk\",\"Eggs\"],\"open\":5}")));
        assertEquals("Shop\nAll done", NoteCard.body(json("{\"kind\":\"list\",\"text\":\"Shop\",\"items\":[],\"open\":0}")));
        assertEquals("“Be kind”", NoteCard.body(json("{\"kind\":\"quote\",\"text\":\"Be kind\"}")));
        assertEquals("— Ann, Letters", NoteCard.byline(json("{\"kind\":\"quote\",\"author\":\"Ann\",\"source\":\"Letters\"}")));
        assertEquals("", NoteCard.byline(json("{\"kind\":\"text\",\"author\":\"Ann\"}")));
        assertEquals("WORK", NoteCard.label(json("{\"kind\":\"quote\",\"category\":\"Work\"}")));
        assertEquals("NOTE", NoteCard.label(json("{\"text\":\"plain\"}")));
    }

    private static JSONArray notes() throws Exception {
        return new JSONArray("[{\"id\":\"a\",\"kind\":\"text\",\"text\":\"A\"},"
            + "{\"id\":\"b\",\"kind\":\"quote\",\"text\":\"B\",\"category\":\"Books\"},"
            + "{\"id\":\"c\",\"kind\":\"list\",\"text\":\"C\",\"category\":\"Work\"}]");
    }

    private static String ids(List<JSONObject> pool) {
        StringBuilder b = new StringBuilder();
        for (JSONObject n : pool) b.append(n.optString("id"));
        return b.toString();
    }

    @Test
    public void aRandomNoteDrawsFromTheKindsAndCategoriesChosenOrAllOfThem() throws Exception {
        assertEquals("abc", ids(RandomNoteWidget.pool(notes(), RandomNoteWidget.defaults())));
        assertEquals("b", ids(RandomNoteWidget.pool(notes(), json("{\"kinds\":[\"quote\"]}"))));
        assertEquals("ac", ids(RandomNoteWidget.pool(notes(), json("{\"cats\":[\"\",\"Work\"]}"))));
        assertEquals("", ids(RandomNoteWidget.pool(notes(), json("{\"kinds\":[\"text\"],\"cats\":[\"Work\"]}"))));
        assertEquals("", ids(RandomNoteWidget.pool(null, RandomNoteWidget.defaults())));
    }

    @Test
    public void anotherNoteIsNeverTheOneShowingWhileThereIsAnother() throws Exception {
        List<JSONObject> pool = RandomNoteWidget.pool(notes(), RandomNoteWidget.defaults());
        java.util.Random r = new java.util.Random(1);
        for (int i = 0; i < 50; i++) assertFalse("b".equals(RandomNoteWidget.pick(pool, "b", r).optString("id")));
        List<JSONObject> one = new ArrayList<>();
        one.add(pool.get(1));
        assertEquals("b", RandomNoteWidget.pick(one, "b", r).optString("id"));
        assertEquals(null, RandomNoteWidget.pick(new ArrayList<>(), "b", r));
    }

    @Test
    public void aRandomNoteTurnsOverOnTheHourTheDayOrOnlyWhenAsked() throws Exception {
        long nine = at("2026-09-24 09:10"), later = at("2026-09-24 09:55"), ten = at("2026-09-24 10:01"), tomorrow = at("2026-09-25 00:01");
        assertFalse(RandomNoteWidget.due("hour", nine, later));
        assertTrue(RandomNoteWidget.due("hour", nine, ten));
        assertFalse(RandomNoteWidget.due("day", nine, ten));
        assertTrue(RandomNoteWidget.due("day", nine, tomorrow));
        assertFalse(RandomNoteWidget.due("tap", nine, tomorrow));
        assertTrue(RandomNoteWidget.due("tap", 0, nine));
    }

    // ---- a to-do widget set to certain lists (0.199.0) ----

    private static JSONObject listed() throws Exception {
        return json("{\"lists\":[{\"id\":\"L1\",\"name\":\"Shop\",\"color\":\"\"},{\"id\":\"L2\",\"name\":\"Work\",\"color\":\"#ff0000\"},"
            + "{\"id\":\"L3\",\"name\":\"Empty\",\"color\":\"\"}],\"todos\":["
            + "{\"id\":\"a\",\"text\":\"Milk\",\"category\":\"Shop\",\"list\":\"L1\"},"
            + "{\"id\":\"b\",\"text\":\"Taxes\",\"category\":\"Work\",\"list\":\"L2\"}]}");
    }

    private static String rowsOf(JSONObject snap, java.util.Set<String> lists) {
        List<String> out = new ArrayList<>();
        for (WidgetStore.Row r : WidgetStore.todoRows(snap, NONE, lists)) {
            if (r.type == WidgetStore.ROW_HEADER) out.add("[" + r.text + ":" + r.id + "]");
            else out.add("o:" + r.id);
        }
        return String.join(" ", out);
    }

    private static java.util.Set<String> set(String... ids) {
        return new java.util.HashSet<>(java.util.Arrays.asList(ids));
    }

    @Test
    public void everyListHasAHeadingThatKnowsItsListEmptyOnesToo() throws Exception {
        assertEquals("[Shop:L1] o:a [Work:L2] o:b [Empty:L3]", rowsOf(listed(), null));
    }

    @Test
    public void aWidgetSetToListsShowsThoseAndOneListNeedsNoHeading() throws Exception {
        assertEquals("[Work:L2] o:b [Empty:L3]", rowsOf(listed(), set("L2", "L3")));
        assertEquals("o:b", rowsOf(listed(), set("L2")));
        assertEquals("Work", WidgetStore.singleList(listed(), set("L2")).optString("name"));
        assertEquals(null, WidgetStore.singleList(listed(), set("L2", "L3")));
        assertEquals(null, WidgetStore.singleList(listed(), set("gone")));
        assertEquals(null, WidgetStore.listsOf(json("{\"lists\":[]}")));
    }

    @Test
    public void aNotesTitleGoesAboveItsWords() throws Exception {
        assertEquals("Idea\nMore words", NoteCard.body(json("{\"kind\":\"text\",\"title\":\"Idea\",\"text\":\"More words\"}")));
        assertEquals("Idea", NoteCard.body(json("{\"kind\":\"text\",\"title\":\"Idea\",\"text\":\"\"}")));
    }
}
