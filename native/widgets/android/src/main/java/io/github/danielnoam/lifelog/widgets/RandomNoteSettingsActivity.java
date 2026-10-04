package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.widget.CheckBox;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The random note widget's settings (0.199.0): the kinds and categories it
 * draws from, how often it changes, and whether it shows the date. Opened
 * when the widget is placed on Android before 12 (from 12 it's optional, and
 * a long press on the widget brings it back). Nothing ticked in a group
 * means all of that group.
 */
public class RandomNoteSettingsActivity extends SettingsScreen {

    private static final String[][] KINDS = { { "text", "Notes" }, { "list", "Checklists" }, { "quote", "Quotes" } };
    private static final String[][] EVERY = {
        { RandomNoteWidget.EVERY_HOUR, "Every hour" },
        { RandomNoteWidget.EVERY_DAY, "Every day" },
        { RandomNoteWidget.EVERY_TAP, "Only when I tap ↻" },
    };

    private JSONObject cfg;
    private final List<CheckBox> kinds = new ArrayList<>();
    private final List<CheckBox> catBoxes = new ArrayList<>();
    private final List<String> catNames = new ArrayList<>();
    private RadioGroup every;
    private CheckBox date;

    @Override
    protected void build() {
        setTitle("Random note");
        cfg = was != null ? was : RandomNoteWidget.defaults();

        heading("Show");
        for (String[] k : KINDS) kinds.add(check(k[1], has(cfg.optJSONArray("kinds"), k[0])));

        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray cats = snap == null ? null : snap.optJSONArray("noteCats");
        if (cats != null && cats.length() > 0) {
            heading("From the categories");
            for (int i = 0; i < cats.length(); i++) {
                JSONObject cat = cats.optJSONObject(i);
                if (cat == null) continue;
                String name = WidgetStore.str(cat, "name");
                catNames.add(name);
                catBoxes.add(check(name, has(cfg.optJSONArray("cats"), name)));
            }
            catNames.add("");
            catBoxes.add(check("No category", has(cfg.optJSONArray("cats"), "")));
        }

        heading("Change it");
        every = new RadioGroup(this);
        String current = WidgetStore.str(cfg, "every");
        for (int i = 0; i < EVERY.length; i++) {
            RadioButton r = new RadioButton(this);
            r.setId(i + 1);
            r.setText(EVERY[i][1]);
            every.addView(r);
            if (EVERY[i][0].equals(current)) every.check(r.getId());
        }
        if (every.getCheckedRadioButtonId() == -1) every.check(2);
        box.addView(every);

        heading("Date");
        date = check("Show the date it was written", cfg.optBoolean("date", true));
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        JSONArray k = new JSONArray();
        for (int i = 0; i < KINDS.length; i++) if (kinds.get(i).isChecked()) k.put(KINDS[i][0]);
        JSONArray c = new JSONArray();
        for (int i = 0; i < catBoxes.size(); i++) if (catBoxes.get(i).isChecked()) c.put(catNames.get(i));
        out.put("kinds", k);
        out.put("cats", c);
        out.put("every", EVERY[Math.max(0, every.getCheckedRadioButtonId() - 1)][0]);
        out.put("date", date.isChecked());
        out.put("current", WidgetStore.str(cfg, "current"));
    }

    // Changed settings draw afresh: the one showing may not fit them.
    @Override
    protected void redraw(AppWidgetManager manager) {
        RandomNoteWidget.draw(this, manager, widgetId, true);
    }
}
