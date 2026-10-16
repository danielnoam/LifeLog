package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Which buttons a quick-add widget has (0.201.0). A button for a tab that's
 * turned off in the app still doesn't show, whatever's ticked here, since it
 * would open nothing. Nothing ticked is every button. Since 0.270.0 they can
 * be put in order too, and fewer buttons keep their labels on a narrower
 * widget (iconsOnly counts only the ones showing).
 */
public class QuickAddSettingsActivity extends SettingsScreen {

    private final Sortable buttons = new Sortable();

    @Override
    protected void build() {
        setTitle("Quick add widget");
        heading("Buttons");
        hint("Hold one and drag to change the order.");
        JSONArray chosen = was == null ? null : was.optJSONArray("buttons");
        boolean all = chosen == null || chosen.length() == 0;
        for (int i : QuickAddWidget.ordered(WidgetStore.orderOf(was))) {
            String action = QuickAddWidget.ACTIONS[i];
            buttons.add(action, QuickAddWidget.LABELS[i]
                + (WidgetStore.offers(this, action) ? "" : " (its tab is off in LifeLog)"), all || has(chosen, action), true);
        }
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        out.put("buttons", buttons.picked());
        out.put("order", buttons.order());
    }

    @Override
    protected void redraw(AppWidgetManager manager) {
        QuickAddWidget.draw(this, manager, widgetId);
    }
}
