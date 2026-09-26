package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
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
public class RandomNoteSettingsActivity extends Activity {

    private static final String[][] KINDS = { { "text", "Notes" }, { "list", "Lists" }, { "quote", "Quotes" } };
    private static final String[][] EVERY = {
        { RandomNoteWidget.EVERY_HOUR, "Every hour" },
        { RandomNoteWidget.EVERY_DAY, "Every day" },
        { RandomNoteWidget.EVERY_TAP, "Only when I tap ↻" },
    };

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        if (intent != null) widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setTitle("Random note");
        JSONObject cfg = WidgetStore.config(this, widgetId);
        if (cfg == null) cfg = RandomNoteWidget.defaults();
        final JSONObject was = cfg;

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        box.setPadding(pad, dp(4), pad, pad);

        heading(box, "Show");
        List<CheckBox> kinds = new ArrayList<>();
        for (String[] k : KINDS) kinds.add(check(box, k[1], has(was.optJSONArray("kinds"), k[0])));

        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray cats = snap == null ? null : snap.optJSONArray("noteCats");
        List<CheckBox> catBoxes = new ArrayList<>();
        List<String> catNames = new ArrayList<>();
        if (cats != null && cats.length() > 0) {
            heading(box, "From the categories");
            for (int i = 0; i < cats.length(); i++) {
                JSONObject cat = cats.optJSONObject(i);
                if (cat == null) continue;
                String name = WidgetStore.str(cat, "name");
                catNames.add(name);
                catBoxes.add(check(box, name, has(was.optJSONArray("cats"), name)));
            }
            catNames.add("");
            catBoxes.add(check(box, "No category", has(was.optJSONArray("cats"), "")));
        }

        heading(box, "Change it");
        RadioGroup every = new RadioGroup(this);
        String current = WidgetStore.str(was, "every");
        for (int i = 0; i < EVERY.length; i++) {
            RadioButton r = new RadioButton(this);
            r.setId(i + 1);
            r.setText(EVERY[i][1]);
            every.addView(r);
            if (EVERY[i][0].equals(current)) every.check(r.getId());
        }
        if (every.getCheckedRadioButtonId() == -1) every.check(2);
        box.addView(every);

        heading(box, "Date");
        CheckBox date = check(box, "Show the date it was written", was.optBoolean("date", true));

        Button save = new Button(this);
        save.setText("Save");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        box.addView(save, lp);
        save.setOnClickListener((v) -> {
            JSONObject out = new JSONObject();
            try {
                JSONArray k = new JSONArray();
                for (int i = 0; i < KINDS.length; i++) if (kinds.get(i).isChecked()) k.put(KINDS[i][0]);
                JSONArray c = new JSONArray();
                for (int i = 0; i < catBoxes.size(); i++) if (catBoxes.get(i).isChecked()) c.put(catNames.get(i));
                out.put("kinds", k);
                out.put("cats", c);
                out.put("every", EVERY[Math.max(0, every.getCheckedRadioButtonId() - 1)][0]);
                out.put("date", date.isChecked());
                // Changed settings draw afresh: the one showing may not fit them.
                out.put("current", WidgetStore.str(was, "current"));
            } catch (JSONException e) {
                return;
            }
            WidgetStore.saveConfig(this, widgetId, out);
            RandomNoteWidget.draw(this, AppWidgetManager.getInstance(this), widgetId, true);
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    private static boolean has(JSONArray a, String s) {
        for (int i = 0; a != null && i < a.length(); i++) if (s.equals(a.optString(i))) return true;
        return false;
    }

    private void heading(LinearLayout box, String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(13);
        t.setAllCaps(true);
        t.setPadding(0, dp(14), 0, dp(4));
        box.addView(t);
    }

    private CheckBox check(LinearLayout box, String text, boolean on) {
        CheckBox b = new CheckBox(this);
        b.setText(text);
        b.setChecked(on);
        box.addView(b);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
