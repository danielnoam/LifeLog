package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.net.Uri;
import android.os.Bundle;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Ledger's Investments: what you hold, then a row per ticker with its
 * close, the day's move and a month's sparkline. Everything is worked out
 * in the app (invest.js's widgetOf) from the prices it keeps; this only
 * draws it. A row opens that ticker, the rest opens Investments.
 *
 * It sheds as it shrinks: the full header and every row that fits, then the
 * header on one line over fewer rows, then only the total.
 */
public class InvestWidget extends AppWidgetProvider {

    static final int DETAIL_TOTAL = 0;
    static final int DETAIL_LINE = 1;
    static final int DETAIL_FULL = 2;

    private static final int ROW_DP = 45;

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
        for (int id : manager.getAppWidgetIds(new ComponentName(c, InvestWidget.class))) {
            manager.updateAppWidget(id, build(c, WidgetSize.of(manager, id)));
        }
    }

    static int detail(int heightDp) {
        if (heightDp <= 0 || heightDp >= 280) return DETAIL_FULL;
        return heightDp >= 150 ? DETAIL_LINE : DETAIL_TOTAL;
    }

    /** How many ticker rows fit under the header (and the foot, when full). */
    static int rowsFit(int heightDp, int detail) {
        if (detail == DETAIL_TOTAL) return 0;
        if (heightDp <= 0) return Integer.MAX_VALUE;
        int room = heightDp - 28 - 8 - (detail == DETAIL_FULL ? 80 + 20 : 28);
        return Math.max(1, room / ROW_DP);
    }

    /** The sparkline's points (0..1, oldest first), or null with under two. */
    static float[] sparkOf(JSONArray a) {
        if (a == null || a.length() < 2) return null;
        float[] out = new float[a.length()];
        for (int i = 0; i < out.length; i++) out[i] = (float) Math.max(0, Math.min(1, a.optDouble(i, 0)));
        return out;
    }

    private static RemoteViews build(Context c, WidgetSize size) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_invest);
        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.openApp(c, "open-invest", 450));
        v.removeAllViews(R.id.invest_rows);
        int up = color(c, R.color.widget_up), down = color(c, R.color.widget_down), muted = color(c, R.color.widget_muted);
        int detail = detail(size.height);
        JSONObject snap = WidgetStore.snapshot(c);
        JSONObject inv = snap == null ? null : snap.optJSONObject("invest");
        JSONArray rows = inv == null ? null : inv.optJSONArray("rows");
        if (inv == null || rows == null || rows.length() == 0) {
            head(v, true);
            v.setTextViewText(R.id.widget_title, "INVESTMENTS");
            v.setTextViewText(R.id.invest_total, "—");
            v.setTextViewText(R.id.invest_gain, snap == null
                ? "Open LifeLog once to bring your investments here"
                : !snap.has("invest") ? "Investments is turned off in LifeLog"
                : "Follow a ticker in the Ledger's Investments to see it here");
            v.setTextColor(R.id.invest_gain, muted);
            v.setViewVisibility(R.id.invest_gain, View.VISIBLE);
            v.setViewVisibility(R.id.invest_rows, View.GONE);
            v.setViewVisibility(R.id.invest_foot, View.GONE);
            return v;
        }
        JSONObject hold = inv.optJSONObject("hold");
        boolean narrow = size.width > 0 && size.width < 150;

        if (detail == DETAIL_LINE) {
            head(v, false);
            v.setTextViewText(R.id.line_title, hold != null ? "YOU HOLD" : "WATCHLIST");
            v.setTextViewText(R.id.line_total, hold != null ? WidgetStore.str(hold, "value") : "");
            String pct = hold != null ? WidgetStore.str(hold, "gainPct") : "";
            v.setTextViewText(R.id.line_gain, pct);
            v.setTextColor(R.id.line_gain, hold != null && hold.optBoolean("up", true) ? up : down);
        } else {
            head(v, true);
            v.setTextViewTextSize(R.id.invest_total, android.util.TypedValue.COMPLEX_UNIT_SP,
                detail == DETAIL_TOTAL || narrow ? 22 : 28);
            SpannableStringBuilder gain = new SpannableStringBuilder();
            if (hold != null) {
                boolean small = detail == DETAIL_TOTAL;
                v.setTextViewText(R.id.widget_title, "YOU HOLD");
                v.setTextViewText(R.id.invest_total, WidgetStore.str(hold, small || size.width < 250 ? "short" : "value"));
                add(gain, WidgetStore.str(hold, small ? "gainPct" : "gain"), hold.optBoolean("up", true) ? up : down);
                String today = WidgetStore.str(hold, small ? "todayPct" : "today");
                if (!today.isEmpty() && gain.length() > 0) add(gain, " · ", muted);
                add(gain, today, hold.optBoolean("todayUp", true) ? up : down);
            } else if (detail == DETAIL_TOTAL) {
                // Nothing held: the first ticker stands in for the total.
                JSONObject r = rows.optJSONObject(0);
                if (r == null) r = new JSONObject();
                v.setTextViewText(R.id.widget_title, WidgetStore.str(r, "symbol"));
                v.setTextViewText(R.id.invest_total, WidgetStore.str(r, "price"));
                String day = WidgetStore.str(r, "day");
                add(gain, day.isEmpty() ? "" : day + " today", r.optBoolean("up", true) ? up : down);
            } else {
                v.setTextViewText(R.id.widget_title, "WATCHLIST");
            }
            v.setTextViewText(R.id.invest_gain, gain);
            v.setViewVisibility(R.id.invest_total, hold != null || detail == DETAIL_TOTAL ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.invest_gain, gain.length() > 0 ? View.VISIBLE : View.GONE);
        }

        int fit = Math.min(rows.length(), rowsFit(size.height, detail));
        boolean sparks = size.width <= 0 || size.width >= 220;
        float density = c.getResources().getDisplayMetrics().density;
        for (int i = 0; i < fit; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            RemoteViews row = new RemoteViews(c.getPackageName(), R.layout.widget_invest_row);
            row.setTextViewText(R.id.row_symbol, WidgetStore.str(r, "symbol"));
            row.setViewVisibility(R.id.row_tag, r.optBoolean("hit") ? View.VISIBLE : View.GONE);
            String sub = WidgetStore.str(r, "sub");
            row.setTextViewText(R.id.row_sub, sub);
            row.setViewVisibility(R.id.row_sub, sub.isEmpty() ? View.GONE : View.VISIBLE);
            row.setTextViewText(R.id.row_price, WidgetStore.str(r, "price"));
            String day = WidgetStore.str(r, "day");
            row.setTextViewText(R.id.row_day, day);
            row.setTextColor(R.id.row_day, r.optBoolean("up", true) ? up : down);
            row.setViewVisibility(R.id.row_day, day.isEmpty() ? View.GONE : View.VISIBLE);
            float[] pts = sparks ? sparkOf(r.optJSONArray("spark")) : null;
            if (pts != null) row.setImageViewBitmap(R.id.row_spark, spark(pts, density, r.optBoolean("sparkUp", true) ? up : down));
            row.setViewVisibility(R.id.row_spark, pts != null ? View.VISIBLE : View.GONE);
            String id = WidgetStore.str(r, "id");
            row.setOnClickPendingIntent(R.id.row, WidgetStore.openAppOn(c, "open-invest:" + id, 451,
                Uri.parse("lifelog-widget://invest/" + Uri.encode(id))));
            v.addView(R.id.invest_rows, row);
        }
        v.setViewVisibility(R.id.invest_rows, fit > 0 ? View.VISIBLE : View.GONE);
        String closed = WidgetStore.str(inv, "closed");
        v.setTextViewText(R.id.invest_foot, closed);
        v.setViewVisibility(R.id.invest_foot, detail == DETAIL_FULL && !closed.isEmpty() ? View.VISIBLE : View.GONE);
        return v;
    }

    private static void head(RemoteViews v, boolean full) {
        v.setViewVisibility(R.id.invest_head, full ? View.VISIBLE : View.GONE);
        v.setViewVisibility(R.id.invest_line, full ? View.GONE : View.VISIBLE);
    }

    private static void add(SpannableStringBuilder b, String text, int color) {
        if (text == null || text.isEmpty()) return;
        int at = b.length();
        b.append(text);
        b.setSpan(new ForegroundColorSpan(color), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    private static int color(Context c, int id) {
        return c.getResources().getColor(id, null);
    }

    private static Bitmap spark(float[] pts, float density, int color) {
        int w = Math.round(64 * density), h = Math.round(24 * density);
        float pad = 2 * density;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.6f * density);
        p.setStrokeJoin(Paint.Join.ROUND);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setColor(color);
        Path path = new Path();
        for (int i = 0; i < pts.length; i++) {
            float x = pad + (w - 2 * pad) * i / (pts.length - 1);
            float y = pad + (h - 2 * pad) * (1 - pts[i]);
            if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        new Canvas(b).drawPath(path, p);
        return b;
    }
}
