package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
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
 * The habits widget's settings (0.201.0): whether it shows each habit's
 * streak and the "N of M today" line under its title. Optional when placed;
 * a long press on the widget brings it back.
 *
 * Since 0.270.0, which habits it shows and in what order, as the checklist
 * widget does its lists: none ticked is every habit, including ones added
 * later, and until it's been put in order it keeps the app's.
 */
public class HabitsSettingsActivity extends SettingsScreen {

    private final Sortable habits = new Sortable();
    private CheckBox streak, summary;

    @Override
    protected void build() {
        setTitle("Habits widget");
        heading("Habits");
        Set<String> chosen = WidgetStore.idsOf(was, "habits");
        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray all = snap == null ? null : snap.optJSONArray("habits");
        List<JSONObject> shown = new ArrayList<>();
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject h = all.optJSONObject(i);
            if (h != null) shown.add(h);
        }
        List<String> order = WidgetStore.orderOf(was);
        if (order != null) Collections.sort(shown, (a, b) -> WidgetStore.rank(order, WidgetStore.str(a, "id")) - WidgetStore.rank(order, WidgetStore.str(b, "id")));
        if (shown.isEmpty()) {
            TextView none = new TextView(this);
            none.setText(all == null
                ? "Open LifeLog once to bring your habits here. Until then the widget shows every habit."
                : "No habits yet. The widget shows every habit you add.");
            box.addView(none);
        } else {
            hint(shown.size() > 1
                ? "None ticked shows every habit, including ones you add later. Hold one and drag to change the order. A habit shows on the days it's due."
                : "None ticked shows every habit, including ones you add later. A habit shows on the days it's due.");
            for (JSONObject h : shown) {
                String id = WidgetStore.str(h, "id");
                habits.add(id, WidgetStore.str(h, "name"), chosen != null && chosen.contains(id), shown.size() > 1);
            }
        }
        heading("Show");
        streak = check("Each habit's streak", flag("streak"));
        summary = check("How many are done today, under the title", flag("summary"));
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        out.put("habits", habits.picked());
        out.put("order", habits.order());
        out.put("streak", streak.isChecked());
        out.put("summary", summary.isChecked());
    }

    @Override
    protected void redraw(AppWidgetManager manager) {
        HabitsWidget.draw(this, manager, widgetId);
    }
}
