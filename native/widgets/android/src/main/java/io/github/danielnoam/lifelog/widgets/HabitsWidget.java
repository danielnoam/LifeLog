package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import java.util.List;

/** Today's habits, each ticked in place. */
public class HabitsWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_HABIT";

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        draw(c, manager, ids);
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
        int[] ids = ListWidget.ids(c, HabitsWidget.class);
        if (ids.length > 0) draw(c, AppWidgetManager.getInstance(c), ids);
    }

    private static void draw(Context c, AppWidgetManager manager, int[] ids) {
        List<WidgetStore.Row> rows = WidgetStore.habitRows(c);
        int kept = 0;
        for (WidgetStore.Row r : rows) if (r.done) kept++;
        String subtitle;
        if (WidgetStore.snapshot(c) == null) subtitle = null;
        else if (rows.isEmpty()) subtitle = "Nothing due today";
        else subtitle = kept + " of " + rows.size() + " today";
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;

        String empty;
        if (WidgetStore.snapshot(c) == null) empty = "Open LifeLog once to bring your habits here";
        else if (WidgetStore.habitCount(c) == 0) empty = "No habits yet — tap + to add one";
        else empty = "Nothing due today";

        for (int id : ids) {
            RemoteViews v = ListWidget.build(c, id, HabitsWidget.class, "habits", ACTION_TICK,
                "Habits", subtitle, empty, "open-habits", "add-habit", 100);
            manager.updateAppWidget(id, v);
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}
