package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What every widget's settings screen shares (0.201.0): which widget it's
 * for, a column of headings and ticks built in code, and a Save that stores
 * the widget's `widget:<id>` config, redraws it and tells Android it's set.
 * Backing out saves nothing, and a widget being placed isn't placed.
 */
abstract class SettingsScreen extends Activity {

    protected int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    /** The widget's saved settings, or null before it has any. */
    protected JSONObject was;
    protected LinearLayout box;

    @Override
    protected final void onCreate(Bundle saved) {
        super.onCreate(saved);
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        if (intent != null) widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        was = WidgetStore.config(this, widgetId);
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(4), dp(16), dp(16));
        build();

        Button save = new Button(this);
        save.setText("Save");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        box.addView(save, lp);
        save.setOnClickListener((v) -> {
            JSONObject out = new JSONObject();
            try {
                collect(out);
            } catch (JSONException e) {
                return;
            }
            WidgetStore.saveConfig(this, widgetId, out);
            redraw(AppWidgetManager.getInstance(this));
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    /** Adds the screen's views to `box`. */
    protected abstract void build();

    /** Writes what's ticked into the widget's new settings. */
    protected abstract void collect(JSONObject out) throws JSONException;

    protected abstract void redraw(AppWidgetManager manager);

    protected void heading(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(13);
        t.setAllCaps(true);
        t.setPadding(0, dp(14), 0, dp(4));
        box.addView(t);
    }

    protected void hint(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setPadding(0, dp(4), 0, dp(8));
        box.addView(t);
    }

    protected CheckBox check(String text, boolean on) {
        CheckBox b = new CheckBox(this);
        b.setText(text);
        b.setChecked(on);
        box.addView(b);
        return b;
    }

    /** A yes/no setting as saved, on until it's been turned off. */
    protected boolean flag(String key) {
        return WidgetStore.flag(was, key);
    }

    static boolean has(JSONArray a, String s) {
        for (int i = 0; a != null && i < a.length(); i++) if (s.equals(a.optString(i))) return true;
        return false;
    }

    protected int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
