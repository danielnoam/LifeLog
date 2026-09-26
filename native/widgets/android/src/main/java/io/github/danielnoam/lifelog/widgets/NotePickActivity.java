package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Which note a note widget shows (0.199.0): Android opens this when one is
 * placed, and the widget opens it again if its note is deleted. The notes
 * are the ones the app last sent, newest first, with a box to search them.
 * Built in code, as it's one list and a search box.
 */
public class NotePickActivity extends Activity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private final List<JSONObject> all = new ArrayList<>();
    private final List<JSONObject> shown = new ArrayList<>();

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // Backing out leaves no widget behind.
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        if (intent != null) widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setTitle("Choose a note");

        JSONArray notes = WidgetStore.notes(WidgetStore.snapshot(this));
        for (int i = 0; notes != null && i < notes.length(); i++) {
            JSONObject n = notes.optJSONObject(i);
            if (n != null) all.add(n);
        }

        int pad = dp(16);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, dp(8), pad, pad);

        if (all.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText(notes == null
                ? "Open LifeLog once, then place this widget again: the notes come from the app."
                : "No notes yet. Write one in LifeLog, then place this widget again.");
            empty.setPadding(0, dp(8), 0, dp(8));
            root.addView(empty);
            setContentView(root);
            return;
        }

        EditText search = new EditText(this);
        search.setHint("Search notes");
        search.setSingleLine(true);
        root.addView(search, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ListView list = new ListView(this);
        Adapter adapter = new Adapter();
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> choose(shown.get(position)));
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(420)));

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int d) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int d) {}
            @Override public void afterTextChanged(Editable s) {
                filter(s.toString());
                adapter.notifyDataSetChanged();
            }
        });
        filter("");
        setContentView(root);
    }

    private void filter(String q) {
        String needle = q.trim().toLowerCase(Locale.ROOT);
        shown.clear();
        for (JSONObject n : all) {
            String hay = (NoteCard.body(n) + " " + NoteCard.byline(n) + " " + WidgetStore.str(n, "category")).toLowerCase(Locale.ROOT);
            if (needle.isEmpty() || hay.contains(needle)) shown.add(n);
        }
    }

    private void choose(JSONObject note) {
        JSONObject cfg = new JSONObject();
        try {
            cfg.put("note", WidgetStore.str(note, "id"));
        } catch (JSONException e) {
            return;
        }
        WidgetStore.saveConfig(this, widgetId, cfg);
        NoteWidget.draw(this, AppWidgetManager.getInstance(this), widgetId);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** A row: the note's first line, and under it its kind or category and date. */
    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return shown.size(); }
        @Override public Object getItem(int i) { return shown.get(i); }
        @Override public long getItemId(int i) { return i; }

        @Override
        public View getView(int i, View convert, ViewGroup parent) {
            View row = convert != null ? convert
                : getLayoutInflater().inflate(android.R.layout.simple_list_item_2, parent, false);
            JSONObject n = shown.get(i);
            String first = NoteCard.body(n).split("\n", 2)[0];
            TextView t1 = row.findViewById(android.R.id.text1);
            TextView t2 = row.findViewById(android.R.id.text2);
            t1.setText(first.isEmpty() ? "Untitled" : first);
            t1.setSingleLine(true);
            t1.setEllipsize(android.text.TextUtils.TruncateAt.END);
            String date = WidgetStore.str(n, "date");
            String cat = WidgetStore.str(n, "category");
            String label = cat.isEmpty() ? NoteCard.label(n).charAt(0) + NoteCard.label(n).substring(1).toLowerCase(Locale.ROOT) : cat;
            t2.setText(label + (date.isEmpty() ? "" : " · " + date));
            return row;
        }
    }
}
