package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/** Buttons that open the app on the right form. */
public class QuickAddWidget extends AppWidgetProvider {

    private static final int[] BUTTONS = { R.id.add_entry, R.id.add_expense, R.id.add_note, R.id.add_todo };
    private static final String[] ACTIONS = { "add-entry", "add-expense", "add-note", "add-todo" };

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        draw(c, manager, ids);
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = manager.getAppWidgetIds(new ComponentName(c, QuickAddWidget.class));
        if (ids.length > 0) draw(c, manager, ids);
    }

    private static void draw(Context c, AppWidgetManager manager, int[] ids) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
        for (int i = 0; i < BUTTONS.length; i++) {
            boolean on = WidgetStore.offers(c, ACTIONS[i]);
            v.setViewVisibility(BUTTONS[i], on ? View.VISIBLE : View.GONE);
            v.setOnClickPendingIntent(BUTTONS[i], WidgetStore.openApp(c, ACTIONS[i], 300 + i));
        }
        for (int id : ids) manager.updateAppWidget(id, v);
    }
}
