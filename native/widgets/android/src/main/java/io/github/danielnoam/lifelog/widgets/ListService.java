package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Paint;
import android.os.Build;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
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
        v.setTextViewText(R.id.row_text, todoText(c, r));
        HabitsWidget.setTick(v, R.id.row_tick, R.id.row_tick_ico, r.done ? "✓" : "");
        int flags = Paint.ANTI_ALIAS_FLAG | (r.done ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
        v.setInt(R.id.row_text, "setPaintFlags", flags);
        v.setTextColor(R.id.row_text, c.getResources().getColor(r.done ? R.color.widget_muted : R.color.widget_text, null));
        v.setInt(R.id.row_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on
            : r.priority == 1 ? R.drawable.widget_tick_p1 : r.priority == 2 ? R.drawable.widget_tick_p2
            : r.priority == 3 ? R.drawable.widget_tick_p3 : R.drawable.widget_tick_off);
        Intent fill = new Intent();
        fill.putExtra(ListWidget.EXTRA_ID, r.id);
        v.setOnClickFillInIntent(R.id.row, fill);
        return v;
    }

    /** A priority's colour (0.317.0), as the app's rings; none is the accent the box always had. */
    static int priorityColor(Context c, int priority) {
        int id = priority == 1 ? R.color.widget_down : priority == 2 ? R.color.widget_amber : R.color.widget_accent;
        return c.getResources().getColor(id, null);
    }

    /**
     * A task's words, and under them (0.317.0) its day by this phone's clock,
     * red when past and green for today, then what else it has. A finished
     * one, or one with nothing set, is its words alone.
     */
    static CharSequence todoText(Context c, WidgetStore.Row r) {
        if (r.done || (r.date.isEmpty() && r.meta.isEmpty())) return r.text;
        String today = WidgetStore.today();
        String when = WidgetStore.taskWhen(r.date, r.time, r.dateText, today);
        SpannableStringBuilder b = new SpannableStringBuilder(r.text).append("\n");
        int line = b.length();
        int muted = c.getResources().getColor(R.color.widget_muted, null);
        if (!when.isEmpty()) {
            int d = BacklogWidgets.daysBetween(today, r.date);
            int color = d < 0 ? c.getResources().getColor(R.color.widget_down, null) : d == 0 ? c.getResources().getColor(R.color.widget_up, null) : muted;
            int at = b.length();
            b.append(when);
            b.setSpan(new ForegroundColorSpan(color), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        if (!r.meta.isEmpty()) {
            int at = b.length();
            b.append(when.isEmpty() ? r.meta : " · " + r.meta);
            b.setSpan(new ForegroundColorSpan(muted), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        b.setSpan(new RelativeSizeSpan(0.86f), line, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    /**
     * Android 12 and up: the row is a real checkbox, so a tap animates the
     * tick on the home screen itself, the way the app's rows do, instead
     * of the whole row being redrawn with the answer.
     */
    private static RemoteViews checkboxRow(Context c, WidgetStore.Row r) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_check);
        v.setTextViewText(R.id.row_check, todoText(c, r));
        v.setCompoundButtonChecked(R.id.row_check, r.done);
        v.setColorStateList(R.id.row_check, "setButtonTintList", ColorStateList.valueOf(priorityColor(c, r.done ? 0 : r.priority)));
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
