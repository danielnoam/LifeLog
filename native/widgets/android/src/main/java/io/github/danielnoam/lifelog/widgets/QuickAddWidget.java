package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Buttons that open the app on the right form. Narrow, each is its icon
 * alone (0.189.0): five labels in two cells were each cut to a letter or two.
 */
public class QuickAddWidget extends AppWidgetProvider {

    private static final int[] BUTTONS = { R.id.add_entry, R.id.add_expense, R.id.add_backlog, R.id.add_note, R.id.add_todo };
    private static final String[] ACTIONS = { "add-entry", "add-expense", "add-backlog", "add-note", "add-todo" };
    private static final String[] ICONS = { "✎", "₪", "★", "▤", "☑" };
    private static final String[] LABELS = { "Entry", "Expense", "Backlog", "Note", "To-do" };
    private static final int LABELLED_DP = 56;

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(c, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, build(c, manager, id));
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : manager.getAppWidgetIds(new ComponentName(c, QuickAddWidget.class))) {
            manager.updateAppWidget(id, build(c, manager, id));
        }
    }

    /** Icons only when the buttons showing would each be narrower than a label needs. */
    static boolean iconsOnly(int widthDp, int buttons) {
        return widthDp > 0 && buttons > 0 && (widthDp - 16) / buttons < LABELLED_DP;
    }

    private static RemoteViews build(Context c, AppWidgetManager manager, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
        int shown = 0;
        for (String action : ACTIONS) if (WidgetStore.offers(c, action)) shown++;
        boolean icons = iconsOnly(WidgetSize.of(manager, widgetId).width, shown);
        for (int i = 0; i < BUTTONS.length; i++) {
            boolean on = WidgetStore.offers(c, ACTIONS[i]);
            v.setViewVisibility(BUTTONS[i], on ? View.VISIBLE : View.GONE);
            v.setTextViewText(BUTTONS[i], icons ? ICONS[i] : ICONS[i] + "\n" + LABELS[i]);
            v.setTextViewTextSize(BUTTONS[i], android.util.TypedValue.COMPLEX_UNIT_SP, icons ? 18 : 12);
            v.setContentDescription(BUTTONS[i], "Add " + LABELS[i].toLowerCase(java.util.Locale.ROOT));
            v.setOnClickPendingIntent(BUTTONS[i], WidgetStore.openApp(c, ACTIONS[i], 300 + i));
        }
        return v;
    }
}
