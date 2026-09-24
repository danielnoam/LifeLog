package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;

/** The to-do list: every panel, scrollable, each item ticked in place. */
public class TodosWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_TODO";

    // Long enough for a checkbox's own tick animation to finish before the
    // row moves down into the finished ones.
    private static final long SETTLE_MS = 650;

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
        if (checked == null) {
            WidgetStore.refreshAll(c);
            WidgetsPlugin.onQueued();
            return;
        }
        // Let the tick play where it happened, then move the row, the way the
        // app lets a ticked row finish before it slides under the line.
        String[] text = text(c);
        ListWidget.refreshHeader(c, TodosWidget.class, ListWidget.header(c, text[0], text[1], text[2]));
        final PendingResult pending = goAsync();
        final Context app = c.getApplicationContext();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                WidgetStore.refreshAll(app);
                WidgetsPlugin.onQueued();
            } finally {
                pending.finish();
            }
        }, SETTLE_MS);
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
