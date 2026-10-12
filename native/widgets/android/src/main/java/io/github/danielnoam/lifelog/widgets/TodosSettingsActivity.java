package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.graphics.drawable.Drawable;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.widget.CheckBox;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A to-do widget's settings: which lists it shows (0.199.0) — nothing ticked
 * is every list, including ones made later — and, since 0.201.0, whether its
 * header counts what's left and whether finished items show under "N done".
 * Opened when it's placed on Android before 12; from 12 it's optional and a
 * long press on the widget brings it back.
 *
 * Since 0.266.0 the lists can be put in order, held and dragged as lists
 * are elsewhere in LifeLog; the widget's panels follow it. The rows stay
 * where they are and what's on them moves: taking a row out of the card
 * mid-drag would cancel the touch that's dragging it.
 */
public class TodosSettingsActivity extends SettingsScreen {

    private final List<CheckBox> boxes = new ArrayList<>();
    private final List<String> ids = new ArrayList<>();
    /** Each row's own background, put back when a held list leaves it. */
    private final List<Drawable> plain = new ArrayList<>();
    private CheckBox count, done;
    /** The row the held list is on while it's dragged, else -1. */
    private int dragging = -1;

    @Override
    protected void build() {
        setTitle("Checklist widget");
        heading("Checklists");
        Set<String> chosen = WidgetStore.listsOf(was);
        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray lists = snap == null ? null : snap.optJSONArray("lists");
        List<JSONObject> shown = new ArrayList<>();
        for (int i = 0; lists != null && i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l != null) shown.add(l);
        }
        List<String> order = WidgetStore.orderOf(was);
        if (order != null) Collections.sort(shown, (a, b) -> WidgetStore.rank(order, WidgetStore.str(a, "id")) - WidgetStore.rank(order, WidgetStore.str(b, "id")));
        hint(shown.size() > 1
            ? "Choose one and the widget's + adds to it. With more, tap a checklist's name on the widget to add to it. None ticked shows every checklist. Hold one and drag to change the order."
            : "Choose one and the widget's + adds to it. With more, tap a checklist's name on the widget to add to it. None ticked shows every checklist.");
        for (JSONObject l : shown) {
            CheckBox b = check(WidgetStore.str(l, "name"), chosen != null && chosen.contains(WidgetStore.str(l, "id")));
            boxes.add(b);
            ids.add(WidgetStore.str(l, "id"));
            if (shown.size() > 1) sortable(b);
        }
        if (boxes.isEmpty()) {
            TextView none = new TextView(this);
            none.setText(lists == null
                ? "Open LifeLog once to bring your checklists here. Until then the widget shows every checklist."
                : "No checklists yet. The widget shows every checklist you make.");
            box.addView(none);
        }
        heading("Show");
        count = check("How many are left, under the title", flag("count"));
        done = check("Finished items, under \"N done\"", flag("done"));
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        JSONArray picked = new JSONArray();
        for (int i = 0; i < boxes.size(); i++) if (boxes.get(i).isChecked()) picked.put(ids.get(i));
        out.put("lists", picked);
        out.put("order", new JSONArray(ids));
        out.put("count", count.isChecked());
        out.put("done", done.isChecked());
    }

    private void sortable(CheckBox b) {
        b.setCompoundDrawablesRelativeWithIntrinsicBounds(null, null, getDrawable(R.drawable.widget_grip), null);
        plain.add(b.getBackground());
        b.setOnLongClickListener((v) -> {
            dragging = boxes.indexOf(v);
            v.getParent().requestDisallowInterceptTouchEvent(true);
            lift(dragging, true);
            return true;
        });
        b.setOnTouchListener((v, e) -> {
            if (dragging < 0) return false;
            int action = e.getActionMasked();
            if (action == MotionEvent.ACTION_MOVE) {
                int to = rowAt(e.getRawY());
                while (to > dragging) step(v, 1);
                while (to < dragging) step(v, -1);
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                lift(dragging, false);
                dragging = -1;
                v.setPressed(false);
            }
            return true;
        });
    }

    private int rowAt(float rawY) {
        int[] at = new int[2];
        for (int i = 0; i < boxes.size() - 1; i++) {
            boxes.get(i).getLocationOnScreen(at);
            if (rawY < at[1] + boxes.get(i).getHeight()) return i;
        }
        return boxes.size() - 1;
    }

    /** Moves the held list one row up (-1) or down (1). */
    private void step(View held, int by) {
        CheckBox from = boxes.get(dragging), to = boxes.get(dragging + by);
        CharSequence name = from.getText();
        boolean on = from.isChecked();
        from.setText(to.getText());
        from.setChecked(to.isChecked());
        to.setText(name);
        to.setChecked(on);
        Collections.swap(ids, dragging, dragging + by);
        lift(dragging, false);
        dragging += by;
        lift(dragging, true);
        held.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
    }

    private void lift(int row, boolean on) {
        boxes.get(row).setBackground(on ? rounded(color(R.color.widget_bg), 10) : plain.get(row));
    }

    // Whole, not the partial refresh: the + comes and goes with the choice.
    @Override
    protected void redraw(AppWidgetManager manager) {
        manager.updateAppWidget(widgetId, TodosWidget.whole(this, manager, widgetId));
        manager.notifyAppWidgetViewDataChanged(new int[] { widgetId }, R.id.widget_list);
    }
}
