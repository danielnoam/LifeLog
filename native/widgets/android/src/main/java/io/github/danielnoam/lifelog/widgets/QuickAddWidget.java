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
 * Its settings choose which buttons it has (0.201.0).
 */
public class QuickAddWidget extends AppWidgetProvider {

    static final String[] ACTIONS = { "add-entry", "add-expense", "add-backlog", "add-note", "add-todo" };
    static final String[] LABELS = { "Entry", "Expense", "Backlog", "Note", "Checklist" };
    // The app's own Lucide drawings (0.269.0), from tools/widget-icons.js.
    static final int[] ICONS = { R.drawable.widget_ico_circle_dot, R.drawable.widget_ico_banknote, R.drawable.widget_ico_star,
        R.drawable.widget_ico_pencil, R.drawable.widget_ico_list_checks };
    private static final int LABELLED_DP = 56;

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(c, manager, id));
    }

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.dropConfig(c, id);
    }

    static void draw(Context c, AppWidgetManager manager, int id) {
        manager.updateAppWidget(id, build(c, manager, id));
    }

    /** Whether a button shows: its tab is on in the app, and this widget has it. */
    static boolean shows(boolean offered, org.json.JSONArray chosen, String action) {
        return offered && (chosen == null || chosen.length() == 0 || SettingsScreen.has(chosen, action));
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

    /** The buttons' indexes in the order the widget's settings put them (0.270.0), the default order without one. */
    static int[] ordered(java.util.List<String> order) {
        Integer[] at = new Integer[ACTIONS.length];
        for (int i = 0; i < at.length; i++) at[i] = i;
        if (order != null) java.util.Arrays.sort(at, (a, b) -> WidgetStore.rank(order, ACTIONS[a]) - WidgetStore.rank(order, ACTIONS[b]));
        int[] out = new int[at.length];
        for (int i = 0; i < at.length; i++) out[i] = at[i];
        return out;
    }

    private static RemoteViews build(Context c, AppWidgetManager manager, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd);
        org.json.JSONObject cfg = WidgetStore.config(c, widgetId);
        org.json.JSONArray chosen = cfg == null ? null : cfg.optJSONArray("buttons");
        int shown = 0;
        for (String action : ACTIONS) if (shows(WidgetStore.offers(c, action), chosen, action)) shown++;
        boolean icons = iconsOnly(WidgetSize.of(manager, widgetId).width, shown);
        v.removeAllViews(R.id.quickadd_row);
        for (int i : ordered(WidgetStore.orderOf(cfg))) {
            if (!shows(WidgetStore.offers(c, ACTIONS[i]), chosen, ACTIONS[i])) continue;
            RemoteViews b = new RemoteViews(c.getPackageName(), R.layout.widget_quickadd_button);
            b.setImageViewResource(R.id.add_icon, ICONS[i]);
            b.setTextViewText(R.id.add_label, LABELS[i]);
            b.setViewVisibility(R.id.add_label, icons ? View.GONE : View.VISIBLE);
            b.setContentDescription(R.id.add_button, "Add " + LABELS[i].toLowerCase(java.util.Locale.ROOT));
            b.setOnClickPendingIntent(R.id.add_button, WidgetStore.openApp(c, ACTIONS[i], 300 + i));
            v.addView(R.id.quickadd_row, b);
        }
        return v;
    }
}
