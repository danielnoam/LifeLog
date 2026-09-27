package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.widget.CheckBox;
import android.widget.TextView;
import java.util.ArrayList;
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
 */
public class TodosSettingsActivity extends SettingsScreen {

    private final List<CheckBox> boxes = new ArrayList<>();
    private final List<String> ids = new ArrayList<>();
    private CheckBox count, done;

    @Override
    protected void build() {
        setTitle("To-do widget");
        heading("Lists");
        hint("Choose one and the widget's + adds to it. With more, tap a list's name on the widget to add to it. None ticked shows every list.");
        Set<String> chosen = WidgetStore.listsOf(was);
        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray lists = snap == null ? null : snap.optJSONArray("lists");
        for (int i = 0; lists != null && i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l == null) continue;
            boxes.add(check(WidgetStore.str(l, "name"), chosen != null && chosen.contains(WidgetStore.str(l, "id"))));
            ids.add(WidgetStore.str(l, "id"));
        }
        if (boxes.isEmpty()) {
            TextView none = new TextView(this);
            none.setText(lists == null
                ? "Open LifeLog once to bring your lists here. Until then the widget shows every list."
                : "No lists yet. The widget shows every list you make.");
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
