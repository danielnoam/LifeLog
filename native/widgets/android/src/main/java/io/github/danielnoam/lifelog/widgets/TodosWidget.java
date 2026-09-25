package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.RemoteViews;

/**
 * The to-do list: every panel, scrollable, each item ticked in place. Small,
 * it's the list alone with a + in the corner (0.189.0) — the header took a
 * third of a two-row widget.
 */
public class TodosWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_TODO";

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, whole(c, manager, id));
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    // Resized across the line between the two layouts: only a whole redraw
    // swaps one for the other. It starts the list from the top again, which
    // after a resize is no loss.
    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, whole(c, manager, id));
        manager.notifyAppWidgetViewDataChanged(new int[] { id }, R.id.widget_list);
    }

    /** The list alone: too narrow for the header beside its +, or too short for it above the list. */
    static boolean compact(int widthDp, int heightDp) {
        return (widthDp > 0 && widthDp < 180) || (heightDp > 0 && heightDp < 150);
    }

    private static int layoutFor(AppWidgetManager manager, int id) {
        WidgetSize size = WidgetSize.of(manager, id);
        return compact(size.width, size.height) ? R.layout.widget_list_compact : R.layout.widget_list;
    }

    private static RemoteViews whole(Context c, AppWidgetManager manager, int id) {
        String[] text = text(c);
        return ListWidget.whole(c, id, layoutFor(manager, id), TodosWidget.class, "todos", ACTION_TICK,
            text[0], text[1], text[2], "open-todos", "add-todo", 200);
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

    /**
     * Android 12's way of filling a list: the rows themselves, with ids that
     * stay put across updates so the list keeps its place.
     */
    static RemoteViews.RemoteCollectionItems items(Context c) {
        RemoteViews.RemoteCollectionItems.Builder b = new RemoteViews.RemoteCollectionItems.Builder()
            .setHasStableIds(true)
            .setViewTypeCount(4);
        String panel = "";
        for (WidgetStore.Row r : WidgetStore.todoRows(c)) {
            if (r.type == WidgetStore.ROW_HEADER) panel = r.text;
            b.addItem(itemId(r, panel), ListService.rowView(c, r));
        }
        return b.build();
    }

    static long itemId(WidgetStore.Row r, String panel) {
        String key = r.type == WidgetStore.ROW_TODO ? "todo:" + r.id : r.type + ":" + panel;
        return key.hashCode();
    }

    static void refresh(Context c) {
        String[] text = text(c);
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        ListWidget.refresh(c, TodosWidget.class, (id) -> ListWidget.header(c, layoutFor(manager, id), text[0], text[1], text[2]));
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
