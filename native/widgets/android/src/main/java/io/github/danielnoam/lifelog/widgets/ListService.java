package io.github.danielnoam.lifelog.widgets;

import android.content.Context;
import android.content.Intent;
import android.graphics.Paint;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

/** Feeds the habits and to-do lists their rows. */
public class ListService extends RemoteViewsService {

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getStringExtra(ListWidget.EXTRA_KIND));
    }

    private static final class Factory implements RemoteViewsService.RemoteViewsFactory {

        private final Context c;
        private final boolean habits;
        private List<WidgetStore.Row> rows = new ArrayList<>();

        Factory(Context c, String kind) {
            this.c = c;
            this.habits = "habits".equals(kind);
        }

        @Override
        public void onCreate() {}

        @Override
        public void onDataSetChanged() {
            rows = habits ? WidgetStore.habitRows(c) : WidgetStore.todoRows(c);
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
            WidgetStore.Row r = rows.get(position);
            if (r.type == WidgetStore.ROW_HEADER) {
                RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_header);
                v.setTextViewText(R.id.row_text, r.text);
                if (r.color != 0) v.setTextColor(R.id.row_text, r.color);
                return v;
            }
            boolean habit = r.type == WidgetStore.ROW_HABIT;
            RemoteViews v = new RemoteViews(c.getPackageName(), habit ? R.layout.widget_row_habit : R.layout.widget_row_todo);
            v.setTextViewText(R.id.row_text, r.text);
            if (habit) {
                v.setTextColor(R.id.row_dot, r.color);
                // A count habit shows how far along today is until it's done.
                String mark = r.done ? "✓" : (r.target > 1 && r.value > 0 ? r.value + "/" + r.target : "");
                v.setTextViewText(R.id.row_tick, mark);
                v.setTextColor(R.id.row_tick, c.getResources().getColor(r.done ? R.color.widget_on_accent : R.color.widget_muted, null));
            } else {
                v.setTextViewText(R.id.row_tick, r.done ? "✓" : "");
                int flags = Paint.ANTI_ALIAS_FLAG | (r.done ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
                v.setInt(R.id.row_text, "setPaintFlags", flags);
                v.setTextColor(R.id.row_text, c.getResources().getColor(r.done ? R.color.widget_muted : R.color.widget_text, null));
            }
            v.setInt(R.id.row_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on : R.drawable.widget_tick_off);

            Intent fill = new Intent();
            fill.putExtra(ListWidget.EXTRA_ID, r.id);
            v.setOnClickFillInIntent(R.id.row, fill);
            return v;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 3;
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
