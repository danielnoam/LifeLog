package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
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
 *
 * Drawn in LifeLog's own look since 0.231.0 rather than the platform
 * dialog's: the widgets' colours (light and night), a title of its own,
 * small-caps headings, each group's ticks on one rounded card, 48dp rows,
 * and Cancel beside a filled Save. Built in code, like the rest of the
 * screen, so a subclass still only says what goes on it.
 */
abstract class SettingsScreen extends Activity {

    protected int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    /** The widget's saved settings, or null before it has any. */
    protected JSONObject was;
    protected LinearLayout box;
    /** The card the ticks under the latest heading go on; null until one is needed. */
    private LinearLayout card;
    private TextView title;

    @Override
    protected final void onCreate(Bundle saved) {
        super.onCreate(saved);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        if (intent != null) widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        was = WidgetStore.config(this, widgetId);
        getWindow().setBackgroundDrawable(rounded(color(R.color.widget_bg), 18));
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(20), dp(20), dp(16));
        title = new TextView(this);
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(color(R.color.widget_text));
        box.addView(title);
        build();

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        alp.topMargin = dp(20);
        box.addView(actions, alp);
        Button cancel = button("Cancel", false);
        cancel.setOnClickListener((v) -> finish());
        actions.addView(cancel);
        Button save = button("Save", true);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.setMarginStart(dp(8));
        actions.addView(save, slp);
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

    @Override
    public void setTitle(CharSequence text) {
        super.setTitle(text);
        if (title != null) title.setText(text);
    }

    protected void heading(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(12);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setAllCaps(true);
        t.setLetterSpacing(0.06f);
        t.setTextColor(color(R.color.widget_muted));
        t.setPadding(dp(4), dp(18), 0, dp(6));
        box.addView(t);
        card = null;
    }

    protected void hint(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(14);
        t.setTextColor(color(R.color.widget_muted));
        t.setLineSpacing(0, 1.15f);
        t.setPadding(dp(4), dp(2), dp(4), dp(10));
        box.addView(t);
        card = null;
    }

    protected CheckBox check(String text, boolean on) {
        if (card == null) {
            card = new LinearLayout(this);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setBackground(rounded(color(R.color.widget_button), 14));
            card.setPadding(dp(8), dp(4), dp(12), dp(4));
            box.addView(card);
        }
        CheckBox b = new CheckBox(this);
        b.setText(text);
        b.setTextSize(15);
        b.setTextColor(color(R.color.widget_text));
        b.setButtonTintList(ColorStateList.valueOf(color(R.color.widget_accent)));
        b.setMinHeight(dp(48));
        b.setPadding(dp(4), 0, 0, 0);
        b.setChecked(on);
        card.addView(b);
        return b;
    }

    private Button button(String text, boolean primary) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setMinHeight(dp(44));
        b.setMinimumHeight(dp(44));
        b.setPadding(dp(20), 0, dp(20), 0);
        b.setStateListAnimator(null);
        b.setTextColor(color(primary ? R.color.widget_on_accent : R.color.widget_text));
        b.setBackground(rounded(color(primary ? R.color.widget_accent : R.color.widget_button), 999));
        return b;
    }

    private GradientDrawable rounded(int fill, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private int color(int id) {
        return getColor(id);
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
