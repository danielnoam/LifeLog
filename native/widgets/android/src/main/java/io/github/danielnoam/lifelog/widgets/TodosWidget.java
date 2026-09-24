package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** The to-do list, scrollable, each item ticked in place. */
public class TodosWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_TODO";

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        draw(c, manager, ids);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (ACTION_TICK.equals(intent.getAction())) {
            WidgetStore.tickTodo(c, intent.getStringExtra(ListWidget.EXTRA_ID));
            WidgetStore.refreshAll(c);
            WidgetsPlugin.onQueued();
            return;
        }
        super.onReceive(c, intent);
    }

    static void refresh(Context c) {
        int[] ids = ListWidget.ids(c, TodosWidget.class);
        if (ids.length > 0) draw(c, AppWidgetManager.getInstance(c), ids);
    }

    private static void draw(Context c, AppWidgetManager manager, int[] ids) {
        boolean loaded = WidgetStore.snapshot(c) != null;
        int open = WidgetStore.openTodoCount(c);
        String subtitle = loaded ? (open == 0 ? "All done" : open + " to do") : null;
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;
        String empty = loaded ? "Nothing to do — tap + to add something" : "Open LifeLog once to bring your list here";

        for (int id : ids) {
            RemoteViews v = ListWidget.build(c, id, TodosWidget.class, "todos", ACTION_TICK,
                "To-do", subtitle, empty, "open-todos", "add-todo", 200);
            manager.updateAppWidget(id, v);
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }
}
