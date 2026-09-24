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
 */
public class HabitsWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_HABIT";
    private static final int ROW_DP = 44;
    private static final int HEADER_DP = 72;

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

    private static RemoteViews build(Context c, AppWidgetManager manager, int widgetId) {
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
        Bundle options = manager.getAppWidgetOptions(widgetId);
        int fit = rowsThatFit(options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT));
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

        // Each habit's intents differ by their data, or Android would hand
        // every row the same PendingIntent.
        Intent tick = new Intent(c, HabitsWidget.class);
        tick.setAction(ACTION_TICK);
        tick.setData(Uri.parse("lifelog-widget://habit/" + Uri.encode(r.id)));
        tick.putExtra(ListWidget.EXTRA_ID, r.id);
        v.setOnClickPendingIntent(R.id.row_tick_hit, PendingIntent.getBroadcast(c, 102, tick,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        v.setOnClickPendingIntent(R.id.row, WidgetStore.openAppOn(c, "open-habit:" + r.id, 103, Uri.parse("lifelog-widget://open/" + Uri.encode(r.id))));
        return v;
    }
}
