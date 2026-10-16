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
 * A to-do widget's settings: which lists it shows (0.199.0) — nothing ticked
 * is every list, including ones made later — and, since 0.201.0, whether its
 * header counts what's left and whether finished items show under "N done".
 * Opened when it's placed on Android before 12; from 12 it's optional and a
 * long press on the widget brings it back.
 *
 * Since 0.266.0 the lists can be put in order, held and dragged as lists
 * are elsewhere in LifeLog; the widget's panels follow it (see Sortable).
 */
public class TodosSettingsActivity extends SettingsScreen {

    private final Sortable lists = new Sortable();
    private CheckBox count, done;

    @Override
    protected void build() {
        setTitle("Checklist widget");
        heading("Checklists");
        Set<String> chosen = WidgetStore.listsOf(was);
        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray all = snap == null ? null : snap.optJSONArray("lists");
        List<JSONObject> shown = new ArrayList<>();
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i);
            if (l != null) shown.add(l);
        }
        List<String> order = WidgetStore.orderOf(was);
        if (order != null) Collections.sort(shown, (a, b) -> WidgetStore.rank(order, WidgetStore.str(a, "id")) - WidgetStore.rank(order, WidgetStore.str(b, "id")));
        hint(shown.size() > 1
            ? "Choose one and the widget's + adds to it. With more, tap a checklist's name on the widget to add to it. None ticked shows every checklist. Hold one and drag to change the order."
            : "Choose one and the widget's + adds to it. With more, tap a checklist's name on the widget to add to it. None ticked shows every checklist.");
        for (JSONObject l : shown) {
            String id = WidgetStore.str(l, "id");
            lists.add(id, WidgetStore.str(l, "name"), chosen != null && chosen.contains(id), shown.size() > 1);
        }
        if (shown.isEmpty()) {
            TextView none = new TextView(this);
            none.setText(all == null
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
        out.put("lists", lists.picked());
        out.put("order", lists.order());
        out.put("count", count.isChecked());
        out.put("done", done.isChecked());
    }

    // Whole, not the partial refresh: the + comes and goes with the choice.
    @Override
    protected void redraw(AppWidgetManager manager) {
        manager.updateAppWidget(widgetId, TodosWidget.whole(this, manager, widgetId));
        manager.notifyAppWidgetViewDataChanged(new int[] { widgetId }, R.id.widget_list);
    }
}
