package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * This month's spending (0.185.0), from the numbers the app works out
 * (app.js's widgetSpend — the currency and the recurring charges live
 * there). The whole widget opens the Ledger.
 *
 * It sheds from the bottom as it shrinks (0.189.0): first the categories,
 * then the comparison with last month, down to the month and its total.
 */
public class SpendWidget extends AppWidgetProvider {

    static final int DETAIL_TOTAL = 0;
    static final int DETAIL_COMPARE = 1;
    static final int DETAIL_CATS = 2;

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
        for (int id : manager.getAppWidgetIds(new ComponentName(c, SpendWidget.class))) {
            manager.updateAppWidget(id, build(c, WidgetSize.of(manager, id)));
        }
    }

    /** How much fits: the categories, the comparison line, or only the total. */
    static int detail(int heightDp) {
        if (heightDp <= 0 || heightDp >= 170) return DETAIL_CATS;
        return heightDp >= 110 ? DETAIL_COMPARE : DETAIL_TOTAL;
    }

    /** Whether the figures are from a month that has since ended. */
    static boolean stale(String month, String today) {
        return month == null || month.isEmpty() || !today.startsWith(month);
    }

    private static RemoteViews build(Context c, WidgetSize size) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_spend);
        int detail = detail(size.height);
        // A four-figure total in a two-cell-wide widget otherwise wraps.
        v.setTextViewTextSize(R.id.spend_total, android.util.TypedValue.COMPLEX_UNIT_SP,
            size.width > 0 && size.width < 150 ? 22 : 28);
        v.setViewVisibility(R.id.spend_cats, detail >= DETAIL_CATS ? View.VISIBLE : View.GONE);
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
        boolean ended = stale(WidgetStore.str(spend, "month"), WidgetStore.today());
        String label = WidgetStore.str(spend, "label").toUpperCase(java.util.Locale.ROOT);
        // Without the line below to say the month has ended, the title does.
        v.setTextViewText(R.id.widget_title, label + (ended && detail == DETAIL_TOTAL ? " · ENDED" : " SO FAR"));
        v.setTextViewText(R.id.spend_total, WidgetStore.str(spend, "total"));
        // The month turned over and the app hasn't run since: say so rather
        // than pass last month's total off as this one's.
        String compare = ended
            ? "A new month — open LifeLog to start counting it"
            : WidgetStore.str(spend, "compare");
        v.setTextViewText(R.id.spend_compare, compare);
        v.setViewVisibility(R.id.spend_compare, compare.isEmpty() || detail == DETAIL_TOTAL ? View.GONE : View.VISIBLE);
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
