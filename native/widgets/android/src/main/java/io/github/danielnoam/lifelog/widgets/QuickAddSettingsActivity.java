package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.widget.CheckBox;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Which buttons a quick-add widget has (0.201.0). A button for a tab that's
 * turned off in the app still doesn't show, whatever's ticked here, since it
 * would open nothing. Nothing ticked is every button.
 */
public class QuickAddSettingsActivity extends SettingsScreen {

    private final List<CheckBox> boxes = new ArrayList<>();

    @Override
    protected void build() {
        setTitle("Quick add widget");
        heading("Buttons");
        JSONArray chosen = was == null ? null : was.optJSONArray("buttons");
        boolean all = chosen == null || chosen.length() == 0;
        for (int i = 0; i < QuickAddWidget.ACTIONS.length; i++) {
            String action = QuickAddWidget.ACTIONS[i];
            CheckBox b = check(QuickAddWidget.ICONS[i] + "  " + QuickAddWidget.LABELS[i]
                + (WidgetStore.offers(this, action) ? "" : " (its tab is off in LifeLog)"), all || has(chosen, action));
            boxes.add(b);
        }
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        JSONArray picked = new JSONArray();
        for (int i = 0; i < boxes.size(); i++) if (boxes.get(i).isChecked()) picked.put(QuickAddWidget.ACTIONS[i]);
        out.put("buttons", picked);
    }

    @Override
    protected void redraw(AppWidgetManager manager) {
        QuickAddWidget.draw(this, manager, widgetId);
    }
}
