package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.RemoteViews;
import org.json.JSONObject;

/**
 * The to-do list: every panel, scrollable, each item ticked in place. Small,
 * it's the list alone with a + in the corner (0.189.0) — the header took a
 * third of a two-row widget.
 *
 * Its settings (TodosSettingsActivity, 0.199.0) choose which lists it shows.
 * Set to one, it's named after it and its + adds to it. Showing more, there's
 * no one list for a + to mean, so each list's heading adds to that list.
 */
public class TodosWidget extends AppWidgetProvider {

    static final String ACTION_TICK = "io.github.danielnoam.lifelog.widgets.TICK_TODO";

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.dropConfig(c, id);
    }

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

    static RemoteViews whole(Context c, AppWidgetManager manager, int id) {
        String[] text = text(c, id);
        JSONObject one = WidgetStore.singleList(WidgetStore.snapshot(c), WidgetStore.listsOf(WidgetStore.config(c, id)));
        return ListWidget.whole(c, id, layoutFor(manager, id), TodosWidget.class, "todos", ACTION_TICK,
            text[0], text[1], text[2], "open-todos", one == null ? null : "add-todo:" + WidgetStore.str(one, "id"), 200);
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!ACTION_TICK.equals(intent.getAction())) {
            super.onReceive(c, intent);
            return;
        }
        // A list's heading: open the app on that list's add line. The
        // template has to be a broadcast for ticks to stay on the home
        // screen, so this is started from here; the tap that sent it is what
        // lets a widget's receiver bring the app up.
        String open = intent.getStringExtra(ListWidget.EXTRA_OPEN);
        if (open != null) {
            try {
                c.startActivity(WidgetStore.launch(c, open));
            } catch (RuntimeException e) {
                // Refused: the heading does nothing rather than crash the widget.
            }
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
    static RemoteViews.RemoteCollectionItems items(Context c, int widgetId) {
        RemoteViews.RemoteCollectionItems.Builder b = new RemoteViews.RemoteCollectionItems.Builder()
            .setHasStableIds(true)
            .setViewTypeCount(4);
        String panel = "";
        for (WidgetStore.Row r : WidgetStore.todoRows(c, widgetId)) {
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
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        ListWidget.refresh(c, TodosWidget.class, (id) -> {
            String[] text = text(c, id);
            return ListWidget.header(c, layoutFor(manager, id), text[0], text[1], text[2]);
        });
    }

    private static String[] text(Context c, int widgetId) {
        JSONObject snap = WidgetStore.snapshot(c);
        boolean loaded = snap != null;
        JSONObject one = WidgetStore.singleList(snap, WidgetStore.listsOf(WidgetStore.config(c, widgetId)));
        int open = WidgetStore.openTodoCount(WidgetStore.todoRows(c, widgetId));
        String subtitle = loaded ? (open == 0 ? "All done" : open + " to do") : null;
        String pending = WidgetStore.pendingNote(c);
        if (pending != null) subtitle = subtitle == null ? pending : subtitle + " · " + pending;
        String empty = !loaded ? "Open LifeLog once to bring your list here"
            : one != null ? "Nothing to do — tap + to add something"
            : "Nothing to do";
        return new String[] { one != null ? WidgetStore.str(one, "name") : "To-do", subtitle, empty };
    }
}
