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
        if (r.type == WidgetStore.ROW_HEADER) return headRow(c, r);
        if (r.type == WidgetStore.ROW_SEP) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_row_sep);
            v.setTextViewText(R.id.row_text, r.text);
            if (r.color != 0) v.setTextColor(R.id.row_text, r.color);
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

    /**
     * A list's heading (0.318.0): the list is a task itself, so it has its
     * own tick in its priority's colour, its name, and its day under it, as
     * the card's head in the app. The + (or the rest of the heading) adds
     * to that list (0.199.0). A heading with no list behind it (an old
     * snapshot) has no tick.
     */
    static RemoteViews headRow(Context c, WidgetStore.Row r) {
        boolean list = !r.id.isEmpty();
        if (list && !r.noTick && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return headCheckRow(c, r);
        RemoteViews v = headText(c, r, R.layout.widget_row_header);
        if (list && r.noTick) {
            v.setViewVisibility(R.id.row_tick_box, android.view.View.GONE);
            return addsTo(v, r);
        }
        if (!list) {
            v.setViewVisibility(R.id.row_tick_box, android.view.View.GONE);
            v.setViewVisibility(R.id.row_add, android.view.View.GONE);
            return v;
        }
        HabitsWidget.setTick(v, R.id.row_tick, R.id.row_tick_ico, r.done ? "✓" : "");
        v.setInt(R.id.row_tick, "setBackgroundResource", r.done ? R.drawable.widget_tick_on
            : r.priority == 1 ? R.drawable.widget_tick_p1 : r.priority == 2 ? R.drawable.widget_tick_p2
            : r.priority == 3 ? R.drawable.widget_tick_p3 : R.drawable.widget_tick_off);
        v.setOnClickFillInIntent(R.id.row_tick_box, tickIntent(r));
        return addsTo(v, r);
    }

    /** Android 12 and up: the heading's tick is a real checkbox, as the rows' are. */
    private static RemoteViews headCheckRow(Context c, WidgetStore.Row r) {
        RemoteViews v = headText(c, r, R.layout.widget_row_head_check);
        v.setCompoundButtonChecked(R.id.row_check, r.done);
        v.setColorStateList(R.id.row_check, "setButtonTintList", ColorStateList.valueOf(priorityColor(c, r.done ? 0 : r.priority)));
        v.setOnCheckedChangeResponse(R.id.row_check, RemoteViews.RemoteResponse.fromFillInIntent(tickIntent(r)));
        return addsTo(v, r);
    }

    private static RemoteViews headText(Context c, WidgetStore.Row r, int layout) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        v.setTextViewText(R.id.row_text, headWords(c, r));
        int flags = Paint.ANTI_ALIAS_FLAG | (r.done ? Paint.STRIKE_THRU_TEXT_FLAG : 0);
        v.setInt(R.id.row_text, "setPaintFlags", flags);
        if (r.done) v.setTextColor(R.id.row_text, c.getResources().getColor(R.color.widget_muted, null));
        return v;
    }

    private static Intent tickIntent(WidgetStore.Row r) {
        Intent tick = new Intent();
        tick.putExtra(ListWidget.EXTRA_ID, r.id);
        return tick;
    }

    /** The name and the + add to that list (0.199.0). */
    private static RemoteViews addsTo(RemoteViews v, WidgetStore.Row r) {
        Intent add = new Intent();
        add.putExtra(ListWidget.EXTRA_OPEN, "add-todo:" + r.id);
        v.setOnClickFillInIntent(R.id.row_add, add);
        v.setOnClickFillInIntent(R.id.row_text, add);
        return v;
    }

    /** The heading's name, bold in its category's colour, and its day and repeat under it. */
    static CharSequence headWords(Context c, WidgetStore.Row r) {
        SpannableStringBuilder b = new SpannableStringBuilder(r.text);
        b.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (r.color != 0 && !r.done) b.setSpan(new ForegroundColorSpan(r.color), 0, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (r.done) return b;
        CharSequence rest = todoText(c, r);
        // todoText starts with the words and a line break; keep only what's under them.
        return b.append(rest.subSequence(r.text.length(), rest.length()));
    }

    /** A priority's colour (0.317.0), as the app's rings; none is the accent the box always had. */
    static int priorityColor(Context c, int priority) {
        int id = priority == 1 ? R.color.widget_down : priority == 2 ? R.color.widget_amber : R.color.widget_accent;
        return c.getResources().getColor(id, null);
    }

    /**
     * A task's words, and under them (0.317.0) its day by this phone's clock,
     * red when past and green for today, then what else it has; since
     * 0.319.1, on a widget showing details, its own category, the repeat in
     * words, a reminder, the deadline and its tags, and under that the first
     * line of its description. A finished one is its words alone. Words, not
     * the app's icons: a span holding a picture doesn't survive the trip to
     * the home screen.
     */
    static CharSequence todoText(Context c, WidgetStore.Row r) {
        SpannableStringBuilder b = new SpannableStringBuilder(r.text);
        if (r.done) return b;
        int muted = c.getResources().getColor(R.color.widget_muted, null);
        int late = c.getResources().getColor(R.color.widget_down, null);
        String today = WidgetStore.today();
        int line = -1;
        // The parts of the line under the words, each with its colour (null:
        // it has its own), joined by " · ".
        java.util.List<Object[]> parts = new java.util.ArrayList<>();
        if (r.details && !r.own.isEmpty()) {
            SpannableStringBuilder own = new SpannableStringBuilder("● ").append(r.own);
            own.setSpan(new ForegroundColorSpan(r.ownColor != 0 ? r.ownColor : muted), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            own.setSpan(new ForegroundColorSpan(muted), 1, own.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            parts.add(new Object[] { own, null });
        }
        String when = WidgetStore.taskWhen(r.date, r.time, r.dateText, today);
        if (!when.isEmpty()) {
            int d = BacklogWidgets.daysBetween(today, r.date);
            parts.add(new Object[] { when, d < 0 ? late : d == 0 ? c.getResources().getColor(R.color.widget_up, null) : muted });
        }
        if (r.details) {
            if (!r.repeatText.isEmpty()) parts.add(new Object[] { r.repeatText, muted });
            else if (!r.meta.isEmpty()) parts.add(new Object[] { r.meta, muted });
            if (r.reminds) parts.add(new Object[] { "Reminder", muted });
            String dl = WidgetStore.deadlineWords(r.deadline, r.deadlineText, today);
            if (!dl.isEmpty()) parts.add(new Object[] { dl, BacklogWidgets.daysBetween(today, r.deadline) < 0 ? late : muted });
            if (!r.tags.isEmpty()) parts.add(new Object[] { r.tags, muted });
        } else if (!r.meta.isEmpty()) parts.add(new Object[] { r.meta, muted });
        if (!parts.isEmpty()) {
            b.append("\n");
            line = b.length();
            for (int i = 0; i < parts.size(); i++) {
                if (i > 0) {
                    int at = b.length();
                    b.append(" · ");
                    b.setSpan(new ForegroundColorSpan(muted), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                int at = b.length();
                b.append((CharSequence) parts.get(i)[0]);
                Object color = parts.get(i)[1];
                if (color != null) b.setSpan(new ForegroundColorSpan((Integer) color), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        if (r.descOn && !r.desc.isEmpty()) {
            b.append("\n");
            if (line < 0) line = b.length();
            int at = b.length();
            b.append(r.desc);
            b.setSpan(new ForegroundColorSpan(muted), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        if (line >= 0) b.setSpan(new RelativeSizeSpan(0.86f), line, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
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
            return 5;
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
