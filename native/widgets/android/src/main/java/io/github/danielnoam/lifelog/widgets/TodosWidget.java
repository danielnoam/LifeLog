package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** The to-do list: every panel, scrollable, each item ticked in place. */
public class TodosWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_TODO";

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        String[] text = text(c);
        for (int id : ids) {
            manager.updateAppWidget(id, ListWidget.whole(c, id, TodosWidget.class, "todos", ACTION_TICK,
                text[0], text[1], text[2], "open-todos", "add-todo", 200));
        }
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!ACTION_TICK.equals(intent.getAction())) {
            super.onReceive(c, intent);
            return;
        }
        // From Android 12 the row is a real checkbox, which has already
        // ticked itself on screen and says which way it went.
        Boolean checked = intent.hasExtra(RemoteViews.EXTRA_CHECKED)
            ? intent.getBooleanExtra(RemoteViews.EXTRA_CHECKED, false)
            : null;
        WidgetStore.tickTodo(c, intent.getStringExtra(ListWidget.EXTRA_ID), checked);
        // Straight away. 0.182.0 held the row back while the box's own tick
        // animation played, and what that felt like was lag.
        WidgetStore.refreshAll(c);
        WidgetsPlugin.onQueued();
    }

    static void refresh(Context c) {
        String[] text = text(c);
        ListWidget.refresh(c, TodosWidget.class, ListWidget.header(c, text[0], text[1], text[2]));
    }

    private static String[] text(Context c) {
        boolean loaded = WidgetStore.snapshot(c) != null;
        int open = WidgetStore.openTodoCount(c);
        String subtitle = loaded ? (open == 0 ? "All done" : open + " to do") : null;
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;
        String empty = loaded ? "Nothing to do — tap + to add something" : "Open LifeLog once to bring your list here";
        return new String[] { "To-do", subtitle, empty };
    }
}
