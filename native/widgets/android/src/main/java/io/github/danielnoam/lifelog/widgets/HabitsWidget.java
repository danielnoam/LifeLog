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
        String[] text = text(c);
        for (int id : ids) {
            manager.updateAppWidget(id, ListWidget.whole(c, id, HabitsWidget.class, "habits", ACTION_TICK,
                text[0], text[1], text[2], "open-habits", "add-habit", 100));
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
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
        String[] text = text(c);
        ListWidget.refresh(c, HabitsWidget.class, ListWidget.header(c, text[0], text[1], text[2]));
    }

    /** Title, subtitle and what an empty list says. */
    private static String[] text(Context c) {
        boolean loaded = WidgetStore.snapshot(c) != null;
        List<WidgetStore.Row> rows = WidgetStore.habitRows(c);
        int kept = 0;
        for (WidgetStore.Row r : rows) if (r.done) kept++;
        String subtitle;
        if (!loaded) subtitle = null;
        else if (rows.isEmpty()) subtitle = "Nothing due today";
        else subtitle = kept + " of " + rows.size() + " today";
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;

        String empty;
        if (!loaded) empty = "Open LifeLog once to bring your habits here";
        else if (WidgetStore.habitCount(c) == 0) empty = "No habits yet — tap + to add one";
        else empty = "Nothing due today";
        return new String[] { "Habits", subtitle, empty };
    }
}
