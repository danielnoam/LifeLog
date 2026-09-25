package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * This month's spending (0.185.0), from the numbers the app works out
 * (app.js's widgetSpend — the currency and the recurring charges live
 * there). The whole widget opens the Ledger.
 */
public class SpendWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        RemoteViews v = build(c);
        for (int id : ids) manager.updateAppWidget(id, v);
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = manager.getAppWidgetIds(new ComponentName(c, SpendWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = build(c);
        for (int id : ids) manager.updateAppWidget(id, v);
    }

    /** Whether the figures are from a month that has since ended. */
    static boolean stale(String month, String today) {
        return month == null || month.isEmpty() || !today.startsWith(month);
    }

    private static RemoteViews build(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_spend);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.openApp(c, "open-finance", 400));
        v.removeAllViews(R.id.spend_cats);
        JSONObject snap = WidgetStore.snapshot(c);
        JSONObject spend = snap == null ? null : snap.optJSONObject("spend");
        if (spend == null) {
            v.setTextViewText(R.id.widget_title, "SPENDING");
            v.setTextViewText(R.id.spend_total, "—");
            v.setTextViewText(R.id.spend_compare, snap == null
                ? "Open LifeLog once to bring your spending here"
                : "The Ledger is turned off in LifeLog");
            return v;
        }
        v.setTextViewText(R.id.widget_title, WidgetStore.str(spend, "label").toUpperCase(java.util.Locale.ROOT) + " SO FAR");
        v.setTextViewText(R.id.spend_total, WidgetStore.str(spend, "total"));
        // The month turned over and the app hasn't run since: say so rather
        // than pass last month's total off as this one's.
        String compare = stale(WidgetStore.str(spend, "month"), WidgetStore.today())
            ? "A new month — open LifeLog to start counting it"
            : WidgetStore.str(spend, "compare");
        v.setTextViewText(R.id.spend_compare, compare);
        v.setViewVisibility(R.id.spend_compare, compare.isEmpty() ? View.GONE : View.VISIBLE);
        JSONArray cats = spend.optJSONArray("cats");
        for (int i = 0; cats != null && i < cats.length(); i++) {
            JSONObject cat = cats.optJSONObject(i);
            if (cat == null) continue;
            RemoteViews row = new RemoteViews(c.getPackageName(), R.layout.widget_spend_cat);
            row.setTextColor(R.id.row_dot, WidgetStore.parseColor(WidgetStore.str(cat, "color"), 0xFF7A8A99));
            row.setTextViewText(R.id.row_text, WidgetStore.str(cat, "name"));
            row.setTextViewText(R.id.row_amount, WidgetStore.str(cat, "amount"));
            v.addView(R.id.spend_cats, row);
        }
        return v;
    }
}
