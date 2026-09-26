package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.os.Build;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

/**
 * Feeds the to-do list its rows before Android 12. From 12 the rows go into
 * the widget update itself (RemoteCollectionItems, see TodosWidget) and this
 * service isn't bound at all; both draw rows with rowView, so they can't
 * drift apart.
 */
public class ListService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(),
            intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    /** One row of the to-do list, however it gets there. */
    static RemoteViews rowView(Context c, WidgetStore.Row r) {
        if (r.type == WidgetStore.ROW_HEADER || r.type == WidgetStore.ROW_SEP) {
            RemoteViews v = new RemoteViews(c.getPackageName(),
                r.type == WidgetStore.ROW_HEADER ? R.layout.widget_row_header : R.layout.widget_row_sep);
            v.setTextViewText(R.id.row_text, r.text);
            if (r.color != 0) v.setTextColor(R.id.row_text, r.color);
            // A list's heading, with more than one list showing, adds to
            // that list (0.199.0).
            if (r.type == WidgetStore.ROW_HEADER && !r.id.isEmpty()) {
                Intent fill = new Intent();
                fill.putExtra(ListWidget.EXTRA_OPEN, "add-todo:" + r.id);
                v.setOnClickFillInIntent(R.id.row, fill);
            }
            return v;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return checkboxRow(c, r);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_todo);
        v.setTextViewText(R.id.row_text, r.text);
        v.setTextViewText(R.id.row_tick, r.done ? "✓" : "");
        int flags = Paint.ANTI_ALIAS_FLAG | (r.done ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
        v.setInt(R.id.row_text, "setPaintFlags", flags);
        v.setTextColor(R.id.row_text, c.getResources().getColor(r.done ? R.color.widget_muted : R.color.widget_text, null));
        v.setInt(R.id.row_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on : R.drawable.widget_tick_off);
        Intent fill = new Intent();
        fill.putExtra(ListWidget.EXTRA_ID, r.id);
        v.setOnClickFillInIntent(R.id.row, fill);
        return v;
    }

    /**
     * Android 12 and up: the row is a real checkbox, so a tap animates the
     * tick on the home screen itself, the way the app's rows do, instead
     * of the whole row being redrawn with the answer.
     */
    private static RemoteViews checkboxRow(Context c, WidgetStore.Row r) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_check);
        v.setTextViewText(R.id.row_check, r.text);
        v.setCompoundButtonChecked(R.id.row_check, r.done);
        int flags = Paint.ANTI_ALIAS_FLAG | (r.done ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
        v.setInt(R.id.row_check, "setPaintFlags", flags);
        v.setTextColor(R.id.row_check, c.getResources().getColor(r.done ? R.color.widget_muted : R.color.widget_text, null));
        Intent fill = new Intent();
        fill.putExtra(ListWidget.EXTRA_ID, r.id);
        v.setOnCheckedChangeResponse(R.id.row_check, RemoteViews.RemoteResponse.fromFillInIntent(fill));
        return v;
    }

    private static final class Factory implements RemoteViewsService.RemoteViewsFactory {

        private final Context c;
        private final int widgetId;
        private List<WidgetStore.Row> rows = new ArrayList<>();

        Factory(Context c, int widgetId) {
            this.c = c;
            this.widgetId = widgetId;
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows = WidgetStore.todoRows(c, widgetId);
        }

        @Override
        public void onDestroy() {}

        @Override
        public int getCount() {
            return rows.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= rows.size()) return null;
            return rowView(c, rows.get(position));
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 4;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}
