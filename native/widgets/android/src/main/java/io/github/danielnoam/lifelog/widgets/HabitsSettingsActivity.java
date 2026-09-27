package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.widget.CheckBox;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The habits widget's settings (0.201.0): whether it shows each habit's
 * streak and the "N of M today" line under its title. Optional when placed;
 * a long press on the widget brings it back.
 */
public class HabitsSettingsActivity extends SettingsScreen {

    private CheckBox streak, summary;

    @Override
    protected void build() {
        setTitle("Habits widget");
        heading("Show");
        streak = check("Each habit's streak 🔥", flag("streak"));
        summary = check("How many are done today, under the title", flag("summary"));
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        out.put("streak", streak.isChecked());
        out.put("summary", summary.isChecked());
    }

    @Override
    protected void redraw(AppWidgetManager manager) {
        HabitsWidget.draw(this, manager, widgetId);
    }
}
