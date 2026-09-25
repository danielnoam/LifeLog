package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.util.List;

/**
 * Today's habits. The tick marks one without opening anything; the rest of
 * its row opens the app on that habit.
 *
 * Plain rows, not a list (0.184.0). Every row of a list widget sends its taps
 * through one shared template, so the tick and the row can't go to different
 * places: the template has to be a broadcast for a tick to stay on the home
 * screen, and a broadcast can't be relied on to open an activity on current
 * Android. Plain views each get their own PendingIntent. The cost is
 * scrolling, so rows are fitted to the widget's height and the last one says
 * how many more there are.
 *
 * Small, it's a grid of ticks instead (0.189.0): a header and named rows
 * don't survive being two cells wide or one row tall, and at that size what
 * you want from it is a thumb's-width target per habit and its streak.
 */
public class HabitsWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_HABIT";
    private static final int ROW_DP = 44;
    private static final int HEADER_DP = 72;
    static final int CHIP_W = 56;
    /** A tick's height with its name and streak under it, its streak only, and neither. */
    static final int[] CHIP_H = { 40, 52, 68 };
    private static final int PAD_DP = 16;

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(c, manager, id));
    }

    // Resized: more or fewer rows fit.
    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, build(c, manager, id));
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (ACTION_TICK.equals(intent.getAction())) {
            WidgetStore.tickHabit(c, intent.getStringExtra(ListWidget.EXTRA_ID));
            WidgetStore.refreshAll(c);
            WidgetsPlugin.onQueued();
            return;
        }
        super.onReceive(c, intent);
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : ListWidget.ids(c, HabitsWidget.class)) manager.updateAppWidget(id, build(c, manager, id));
    }

    /** How many rows the widget is tall enough for, portrait being the tighter. */
    static int rowsThatFit(int heightDp) {
        if (heightDp <= 0) return 3;
        return Math.max(1, (heightDp - HEADER_DP) / ROW_DP);
    }

    /** The grid instead of the list: too narrow for a name beside its tick, or too short for two rows. */
    static boolean compact(int widthDp, int heightDp) {
        return (widthDp > 0 && widthDp < 200) || (heightDp > 0 && rowsThatFit(heightDp) < 2);
    }

    /** What fits under each tick: 2 its name and streak, 1 its streak, 0 nothing. */
    static int chipDetail(int heightDp) {
        if (heightDp <= 0) return 2;
        int room = heightDp - PAD_DP;
        return room >= CHIP_H[2] ? 2 : room >= CHIP_H[1] ? 1 : 0;
    }

    /** {columns, rows} of ticks the widget has room for. */
    static int[] chipGrid(int widthDp, int heightDp) {
        int cols = widthDp <= 0 ? 4 : Math.max(1, (widthDp - PAD_DP) / CHIP_W);
        int rows = heightDp <= 0 ? 1 : Math.max(1, (heightDp - PAD_DP) / CHIP_H[chipDetail(heightDp)]);
        return new int[] { cols, rows };
    }

    private static RemoteViews build(Context c, AppWidgetManager manager, int widgetId) {
        WidgetSize size = WidgetSize.of(manager, widgetId);
        if (compact(size.width, size.height)) return grid(c, size);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_habits);
        boolean loaded = WidgetStore.snapshot(c) != null;
        List<WidgetStore.Row> rows = WidgetStore.habitRows(c);

        int kept = 0;
        for (WidgetStore.Row r : rows) if (r.done) kept++;
        String subtitle = !loaded ? null : rows.isEmpty() ? "Nothing due today" : kept + " of " + rows.size() + " today";
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;
        v.setTextViewText(R.id.widget_title, "Habits");
        v.setTextViewText(R.id.widget_subtitle, subtitle == null ? "" : subtitle);
        v.setViewVisibility(R.id.widget_subtitle, subtitle == null ? View.GONE : View.VISIBLE);
        v.setOnClickPendingIntent(R.id.widget_header, WidgetStore.openApp(c, "open-habits", 100));
        v.setOnClickPendingIntent(R.id.widget_add, WidgetStore.openApp(c, "add-habit", 101));

        String empty = !loaded ? "Open LifeLog once to bring your habits here"
            : WidgetStore.habitCount(c) == 0 ? "No habits yet — tap + to add one"
            : "Nothing due today";
        v.setTextViewText(R.id.widget_empty, empty);
        v.setViewVisibility(R.id.widget_empty, rows.isEmpty() ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(R.id.widget_empty, WidgetStore.openApp(c, "open-habits", 100));

        v.removeAllViews(R.id.habit_rows);
        int fit = rowsThatFit(size.height);
        // Room for all of them, or all but one plus a line saying how many more.
        int shown = rows.size() <= fit ? rows.size() : Math.max(0, fit - 1);
        for (int i = 0; i < shown; i++) v.addView(R.id.habit_rows, row(c, rows.get(i)));
        if (shown < rows.size()) {
            RemoteViews more = new RemoteViews(c.getPackageName(), R.layout.widget_row_more);
            int rest = rows.size() - shown;
            more.setTextViewText(R.id.row_text, "+" + rest + " more — open LifeLog");
            more.setOnClickPendingIntent(R.id.row_text, WidgetStore.openApp(c, "open-habits", 100));
            v.addView(R.id.habit_rows, more);
        }
        return v;
    }

    private static RemoteViews grid(Context c, WidgetSize size) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_habits_compact);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.openApp(c, "open-habits", 100));
        v.removeAllViews(R.id.habit_grid);
        boolean loaded = WidgetStore.snapshot(c) != null;
        List<WidgetStore.Row> rows = WidgetStore.habitRows(c);
        String empty = !loaded ? "Open LifeLog once to bring your habits here"
            : WidgetStore.habitCount(c) == 0 ? "No habits yet" : "Nothing due today";
        v.setTextViewText(R.id.widget_empty, empty);
        v.setViewVisibility(R.id.widget_empty, rows.isEmpty() ? View.VISIBLE : View.GONE);
        if (rows.isEmpty()) return v;

        int[] grid = chipGrid(size.width, size.height);
        int detail = chipDetail(size.height);
        int room = grid[0] * grid[1];
        // All of them, or all but one and a last chip saying how many more.
        int shown = rows.size() <= room ? rows.size() : room - 1;
        int cells = shown < rows.size() ? shown + 1 : shown;
        // No more rows than there are habits to fill: three habits in a tall
        // narrow widget are one row, centred, not three rows and six blanks.
        int cols = Math.min(grid[0], cells);
        for (int start = 0; start < cells; start += cols) {
            RemoteViews line = new RemoteViews(c.getPackageName(), R.layout.widget_chip_row);
            for (int i = start; i < start + cols; i++) {
                if (i < shown) line.addView(R.id.chip_row, chip(c, rows.get(i), detail));
                else if (i < cells) line.addView(R.id.chip_row, moreChip(c, rows.size() - shown, detail));
                // Blank chips keep the last row's ticks lined up under the ones above.
                else line.addView(R.id.chip_row, blankChip(c, detail));
            }
            v.addView(R.id.habit_grid, line);
        }
        return v;
    }

    /** The letter a tick shows until it's kept: the name's first character. */
    static String initial(String name) {
        String t = name == null ? "" : name.trim();
        if (t.isEmpty()) return "•";
        return new String(Character.toChars(t.codePointAt(0))).toUpperCase(java.util.Locale.ROOT);
    }

    private static RemoteViews chip(Context c, WidgetStore.Row r, int detail) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chip_habit);
        boolean partway = !r.done && r.target > 1 && r.value > 0;
        v.setTextViewText(R.id.chip_tick, r.done ? "✓" : partway ? r.value + "/" + r.target : initial(r.text));
        v.setTextColor(R.id.chip_tick, r.done ? c.getResources().getColor(R.color.widget_on_accent, null)
            : partway ? c.getResources().getColor(R.color.widget_muted, null) : r.color);
        v.setInt(R.id.chip_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on : R.drawable.widget_tick_off);
        v.setTextViewText(R.id.chip_name, r.text);
        v.setViewVisibility(R.id.chip_name, detail >= 2 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.chip_streak, r.streak > 0 ? "🔥" + r.streak : "");
        v.setViewVisibility(R.id.chip_streak, detail >= 1 ? View.VISIBLE : View.GONE);
        v.setContentDescription(R.id.chip, r.text + (r.done ? ", done" : ""));
        v.setOnClickPendingIntent(R.id.chip, tickIntent(c, r.id));
        return v;
    }

    private static RemoteViews moreChip(Context c, int rest, int detail) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chip_habit);
        v.setTextViewText(R.id.chip_tick, "+" + rest);
        v.setTextColor(R.id.chip_tick, c.getResources().getColor(R.color.widget_muted, null));
        v.setTextViewText(R.id.chip_name, "more");
        v.setViewVisibility(R.id.chip_name, detail >= 2 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.chip_streak, "");
        v.setViewVisibility(R.id.chip_streak, detail >= 1 ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(R.id.chip, WidgetStore.openApp(c, "open-habits", 100));
        return v;
    }

    private static RemoteViews blankChip(Context c, int detail) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_chip_habit);
        v.setViewVisibility(R.id.chip, View.INVISIBLE);
        v.setViewVisibility(R.id.chip_name, detail >= 2 ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.chip_streak, detail >= 1 ? View.VISIBLE : View.GONE);
        return v;
    }

    // Each habit's intents differ by their data, or Android would hand every
    // row the same PendingIntent.
    private static PendingIntent tickIntent(Context c, String id) {
        Intent tick = new Intent(c, HabitsWidget.class);
        tick.setAction(ACTION_TICK);
        tick.setData(Uri.parse("lifelog-widget://habit/" + Uri.encode(id)));
        tick.putExtra(ListWidget.EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, 102, tick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews row(Context c, WidgetStore.Row r) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_habit);
        v.setTextViewText(R.id.row_text, r.text);
        v.setTextColor(R.id.row_dot, r.color);
        v.setTextViewText(R.id.row_streak, r.streak > 0 ? "🔥" + r.streak : "");
        v.setViewVisibility(R.id.row_streak, r.streak > 0 ? View.VISIBLE : View.GONE);
        // A counted habit shows how far along today is until it's done.
        v.setTextViewText(R.id.row_tick, r.done ? "✓" : (r.target > 1 && r.value > 0 ? r.value + "/" + r.target : ""));
        v.setTextColor(R.id.row_tick, c.getResources().getColor(r.done ? R.color.widget_on_accent : R.color.widget_muted, null));
        v.setInt(R.id.row_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on : R.drawable.widget_tick_off);

        v.setOnClickPendingIntent(R.id.row_tick_hit, tickIntent(c, r.id));
        v.setOnClickPendingIntent(R.id.row, WidgetStore.openAppOn(c, "open-habit:" + r.id, 103, Uri.parse("lifelog-widget://open/" + Uri.encode(r.id))));
        return v;
    }
}
