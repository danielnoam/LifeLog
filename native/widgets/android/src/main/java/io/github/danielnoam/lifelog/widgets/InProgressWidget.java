package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.widget.RemoteViews;

/** See BacklogWidgets. */
public class InProgressWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(c, WidgetSize.of(manager, id)));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, build(c, WidgetSize.of(manager, id)));
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : manager.getAppWidgetIds(new ComponentName(c, InProgressWidget.class))) {
            manager.updateAppWidget(id, build(c, WidgetSize.of(manager, id)));
        }
    }

    private static RemoteViews build(Context c, WidgetSize size) {
        return BacklogWidgets.build(c, size, "IN PROGRESS", "inProgress", "open-timeline", 420, "Nothing started — start something from the Backlog");
    }
}
