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
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Which lists a to-do widget shows (0.199.0). Opened when it's placed on
 * Android before 12; from 12 it's optional and a long press on the widget
 * brings it back. Nothing ticked is every list, including ones made later.
 */
public class TodosSettingsActivity extends Activity {

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
        setTitle("Lists to show");
        Set<String> chosen = WidgetStore.listsOf(WidgetStore.config(this, widgetId));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        box.setPadding(pad, dp(4), pad, pad);

        TextView hint = new TextView(this);
        hint.setText("Choose one and the widget's + adds to it. With more, tap a list's name on the widget to add to it. None ticked shows every list.");
        hint.setPadding(0, dp(4), 0, dp(8));
        box.addView(hint);

        JSONObject snap = WidgetStore.snapshot(this);
        JSONArray lists = snap == null ? null : snap.optJSONArray("lists");
        List<CheckBox> boxes = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        for (int i = 0; lists != null && i < lists.length(); i++) {
            JSONObject l = lists.optJSONObject(i);
            if (l == null) continue;
            CheckBox b = new CheckBox(this);
            b.setText(WidgetStore.str(l, "name"));
            b.setChecked(chosen != null && chosen.contains(WidgetStore.str(l, "id")));
            box.addView(b);
            boxes.add(b);
            ids.add(WidgetStore.str(l, "id"));
        }
        if (boxes.isEmpty()) {
            TextView none = new TextView(this);
            none.setText(lists == null
                ? "Open LifeLog once to bring your lists here. Until then the widget shows every list."
                : "No lists yet. The widget shows every list you make.");
            box.addView(none);
        }

        Button save = new Button(this);
        save.setText("Save");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        box.addView(save, lp);
        save.setOnClickListener((v) -> {
            JSONArray picked = new JSONArray();
            for (int i = 0; i < boxes.size(); i++) if (boxes.get(i).isChecked()) picked.put(ids.get(i));
            JSONObject out = new JSONObject();
            try {
                out.put("lists", picked);
            } catch (JSONException e) {
                return;
            }
            WidgetStore.saveConfig(this, widgetId, out);
            AppWidgetManager manager = AppWidgetManager.getInstance(this);
            // Whole, not the partial refresh: the + comes and goes with the choice.
            manager.updateAppWidget(widgetId, TodosWidget.whole(this, manager, widgetId));
            manager.notifyAppWidgetViewDataChanged(new int[] { widgetId }, R.id.widget_list);
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
