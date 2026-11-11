package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The quick-add window: a widget's add button opens this over the home
 * screen instead of the app. A home-screen widget can't hold a text field,
 * so this is the nearest thing: a small window that never starts the web
 * app, fills its choices from the snapshot the app last sent, and puts what
 * you add on the widgets' queue, where the app picks it up the next time it
 * runs (widgets.js applyQueue), saves it and syncs it like a tick.
 *
 * What it can't do is anything that needs the app: a cover or details
 * looked up, a rate for another currency, a habit. "Open in LifeLog" takes
 * what's typed to the app's own form for those.
 *
 * Built in code in the widgets' colours, like SettingsScreen.
 */
public class QuickAddActivity extends Activity {

    static final String EXTRA_ACTION = "io.github.danielnoam.lifelog.widgets.QUICK";

    static final String[] KINDS = { "entry", "expense", "backlog", "note", "item" };
    private static final String[] ADD_LABELS = { "Add entry", "Add expense", "Add to backlog", "Add note", "Add item" };

    private JSONObject snap;
    private String kind = "entry";
    private String list = "";
    private SharedPreferences prefs;

    private LinearLayout form;
    private TextView addButton;
    private TextView addedLine;
    private final List<String> added = new ArrayList<>();

    private EditText title, text, notes, amount;
    private String category = "", sub = "", date = "";
    private int rating;
    private boolean starred;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        snap = WidgetStore.snapshot(this);
        prefs = WidgetStore.prefs(this);
        String action = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_ACTION);
        if (!WidgetStore.quickReady(snap, action)) {
            // Nothing to fill the choices from yet, or the lock is on: the app's own form.
            openApp(action == null ? null : action);
            return;
        }
        kind = WidgetStore.quickKind(action);
        if (action.startsWith("add-todo:")) list = action.substring("add-todo:".length());

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(10), dp(16), dp(16));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color(R.color.widget_bg));
        float r = dp(24);
        bg.setCornerRadii(new float[] { r, r, r, r, 0, 0, 0, 0 });
        box.setBackground(bg);

        View handle = new View(this);
        handle.setBackground(rounded(color(R.color.widget_ring), 999));
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(dp(36), dp(4));
        hlp.gravity = Gravity.CENTER_HORIZONTAL;
        hlp.bottomMargin = dp(10);
        box.addView(handle, hlp);

        box.addView(tabs());

        form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(form);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
        box.addView(scroll, slp);

        addedLine = new TextView(this);
        addedLine.setTextSize(13);
        addedLine.setTextColor(color(R.color.widget_muted));
        addedLine.setPadding(dp(4), dp(8), dp(4), 0);
        addedLine.setVisibility(View.GONE);
        box.addView(addedLine);

        LinearLayout foot = new LinearLayout(this);
        foot.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        flp.topMargin = dp(14);
        box.addView(foot, flp);
        TextView open = pill("Open in LifeLog", false);
        open.setBackground(null);
        open.setTextColor(color(R.color.widget_accent));
        open.setPadding(dp(4), 0, dp(12), 0);
        open.setOnClickListener((v) -> { forgetDraft(); openApp(fullFormAction()); });
        foot.addView(open);
        View gap = new View(this);
        foot.addView(gap, new LinearLayout.LayoutParams(0, 1, 1));
        addButton = pill("", true);
        addButton.setOnClickListener((v) -> add());
        foot.addView(addButton);

        setContentView(box);
        Window w = getWindow();
        w.setBackgroundDrawable(new ColorDrawable(0));
        w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        w.setGravity(Gravity.BOTTOM);
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        setFinishOnTouchOutside(true);
        build();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (form != null) keepDraft();
    }

    // ---- the kinds along the top ----

    private HorizontalScrollView tabs() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        scroll.addView(row);
        for (int i = 0; i < KINDS.length; i++) {
            String action = QuickAddWidget.ACTIONS[i];
            if (!WidgetStore.offers(this, action) || !WidgetStore.quickReady(snap, action)) continue;
            String k = KINDS[i];
            LinearLayout tab = new LinearLayout(this);
            tab.setGravity(Gravity.CENTER_VERTICAL);
            tab.setPadding(dp(12), 0, dp(14), 0);
            tab.setMinimumHeight(dp(40));
            ImageView ico = new ImageView(this);
            ico.setImageResource(QuickAddWidget.ICONS[i]);
            tab.addView(ico, new LinearLayout.LayoutParams(dp(18), dp(18)));
            TextView label = new TextView(this);
            label.setText(QuickAddWidget.LABELS[i]);
            label.setTextSize(14);
            label.setTypeface(Typeface.DEFAULT_BOLD);
            label.setPadding(dp(6), 0, 0, 0);
            boolean on = k.equals(kind);
            // Five labels don't fit a phone's width: the one you're on says
            // what it is, the others are their icons.
            if (on) tab.addView(label);
            else tab.setPadding(dp(13), 0, dp(13), 0);
            tab.setMinimumWidth(dp(44));
            int fg = color(on ? R.color.widget_on_accent : R.color.widget_text);
            tab.setBackground(rounded(color(on ? R.color.widget_accent : R.color.widget_button), 999));
            ico.setImageTintList(ColorStateList.valueOf(fg));
            label.setTextColor(fg);
            tab.setContentDescription(QuickAddWidget.LABELS[i]);
            tab.setOnClickListener((v) -> {
                if (k.equals(kind)) return;
                keepDraft();
                kind = k;
                ViewGroup parent = (ViewGroup) scroll.getParent();
                int at = parent.indexOfChild(scroll);
                parent.removeViewAt(at);
                parent.addView(tabs(), at);
                build();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(dp(6));
            row.addView(tab, lp);
        }
        return scroll;
    }

    // ---- each kind's form ----

    private void build() {
        form.removeAllViews();
        title = text = notes = amount = null;
        sub = "";
        rating = 0;
        starred = false;
        date = WidgetStore.today();
        category = prefs.getString("quick:cat:" + kind, "");
        added.clear();
        addedLine.setVisibility(View.GONE);
        JSONObject draft = draft();
        switch (kind) {
            case "entry":
                title = field("What did you finish?", false);
                label("Category");
                category = pickCategory(snap.optJSONArray("entryCats"), category, false);
                label("Finished");
                dates();
                label("Rating");
                stars();
                notes = field("Notes (optional)", true);
                break;
            case "expense":
                amountField();
                notes = field("What or where", false);
                label("Category");
                expenseCategories();
                label("Date");
                dates();
                break;
            case "backlog":
                title = field("What's next?", false);
                label("Category");
                category = pickCategory(snap.optJSONArray("entryCats"), category, false);
                starToggle();
                notes = field("Notes (optional)", true);
                break;
            case "note":
                title = field("Title (optional)", false);
                text = field("Write something", true);
                text.setMinLines(4);
                label("Category");
                category = pickCategory(snap.optJSONArray("noteCats"), category, true);
                break;
            default:
                lists();
                text = field("Add an item", false);
                text.setImeOptions(EditorInfo.IME_ACTION_DONE);
                break;
        }
        if (draft != null) {
            fill(title, draft.optString("title"));
            fill(text, draft.optString("text"));
            fill(notes, draft.optString("notes"));
            fill(amount, draft.optString("amount"));
        }
        EditText first = amount != null ? amount : title != null ? title : text;
        if (first != null) {
            first.requestFocus();
            first.setSelection(first.getText().length());
        }
        addButton.setText(ADD_LABELS[indexOf(kind)]);
        refreshAdd();
    }

    private static void fill(EditText e, String s) {
        if (e != null && s != null && !s.isEmpty()) e.setText(s);
    }

    /** A category chip row; returns the one picked to start with. */
    private String pickCategory(JSONArray cats, String last, boolean noneFirst) {
        List<String[]> opts = new ArrayList<>();
        if (noneFirst) opts.add(new String[] { "", "None", "" });
        boolean lastThere = false;
        for (int i = 0; cats != null && i < cats.length(); i++) {
            JSONObject c = cats.optJSONObject(i);
            if (c == null) continue;
            String name = WidgetStore.str(c, "name");
            opts.add(new String[] { name, name, WidgetStore.str(c, "color") });
            if (name.equals(last)) lastThere = true;
        }
        String start = lastThere ? last : opts.isEmpty() ? "" : opts.get(0)[0];
        chips(opts, start, (id) -> category = id);
        return start;
    }

    private void expenseCategories() {
        JSONArray cats = snap.optJSONArray("financeCats");
        List<String[]> opts = new ArrayList<>();
        opts.add(new String[] { "", "Auto", "" });
        boolean lastThere = false;
        for (int i = 0; cats != null && i < cats.length(); i++) {
            JSONObject c = cats.optJSONObject(i);
            if (c == null) continue;
            String name = WidgetStore.str(c, "name");
            opts.add(new String[] { name, name, WidgetStore.str(c, "color") });
            if (name.equals(category)) lastThere = true;
        }
        if (!lastThere) category = "";
        TextView hint = hint("");
        LinearLayout subs = new LinearLayout(this);
        subs.setOrientation(LinearLayout.VERTICAL);
        chips(opts, category, (id) -> {
            category = id;
            sub = "";
            showSubs(subs, hint);
        }, form.getChildCount() - 1);
        form.addView(subs, form.getChildCount() - 1);
        showSubs(subs, hint);
    }

    private void showSubs(LinearLayout holder, TextView hint) {
        holder.removeAllViews();
        hint.setText(category.isEmpty()
            ? "Filed where this name went last time, else your first category"
            : "");
        hint.setVisibility(category.isEmpty() ? View.VISIBLE : View.GONE);
        JSONArray subs = null;
        JSONArray cats = snap.optJSONArray("financeCats");
        for (int i = 0; cats != null && i < cats.length(); i++) {
            JSONObject c = cats.optJSONObject(i);
            if (c != null && category.equals(WidgetStore.str(c, "name"))) subs = c.optJSONArray("subs");
        }
        if (subs == null || subs.length() == 0) return;
        List<String[]> opts = new ArrayList<>();
        opts.add(new String[] { "", "No subcategory", "" });
        for (int i = 0; i < subs.length(); i++) opts.add(new String[] { subs.optString(i), subs.optString(i), "" });
        LinearLayout keep = form;
        form = holder;
        chips(opts, "", (id) -> sub = id);
        form = keep;
    }

    private void lists() {
        JSONArray all = snap.optJSONArray("lists");
        List<String[]> opts = new ArrayList<>();
        String last = prefs.getString("quick:cat:item", "");
        boolean listThere = false, lastThere = false;
        for (int i = 0; all != null && i < all.length(); i++) {
            JSONObject l = all.optJSONObject(i);
            if (l == null) continue;
            String id = WidgetStore.str(l, "id");
            opts.add(new String[] { id, WidgetStore.str(l, "name"), WidgetStore.str(l, "color") });
            if (id.equals(list)) listThere = true;
            if (id.equals(last)) lastThere = true;
        }
        if (!listThere) list = lastThere ? last : opts.isEmpty() ? "" : opts.get(0)[0];
        if (opts.size() > 1) {
            label("List");
            chips(opts, list, (id) -> list = id);
        } else if (opts.size() == 1) {
            label(opts.get(0)[1]);
        }
    }

    private void dates() {
        String today = WidgetStore.today(), yesterday = WidgetStore.addDays(today, -1);
        List<String[]> opts = new ArrayList<>();
        opts.add(new String[] { today, "Today", "" });
        opts.add(new String[] { yesterday, "Yesterday", "" });
        opts.add(new String[] { "pick", "Pick a day", "" });
        Chips[] self = new Chips[1];
        self[0] = chips(opts, today, (id) -> {
            if (!"pick".equals(id)) {
                date = id;
                self[0].rename(2, "Pick a day");
                return;
            }
            Calendar cal = WidgetStore.dayOf(date);
            if (cal == null) cal = Calendar.getInstance();
            new DatePickerDialog(this, (picker, y, m, d) -> {
                date = String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, d);
                if (date.equals(today)) self[0].select(0);
                else if (date.equals(yesterday)) self[0].select(1);
                else self[0].rename(2, dayLabel(date));
            }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show();
        });
    }

    static String dayLabel(String ymd) {
        Calendar cal = WidgetStore.dayOf(ymd);
        if (cal == null) return ymd;
        boolean thisYear = cal.get(Calendar.YEAR) == Calendar.getInstance().get(Calendar.YEAR);
        return new SimpleDateFormat(thisYear ? "EEE d MMM" : "d MMM yyyy", Locale.getDefault()).format(cal.getTime());
    }

    private void stars() {
        LinearLayout row = new LinearLayout(this);
        TextView[] all = new TextView[5];
        for (int i = 0; i < 5; i++) {
            int n = i + 1;
            TextView s = new TextView(this);
            s.setText("★");
            s.setTextSize(28);
            s.setGravity(Gravity.CENTER);
            s.setMinWidth(dp(44));
            s.setMinHeight(dp(44));
            s.setContentDescription(n + (n == 1 ? " star" : " stars"));
            s.setOnClickListener((v) -> {
                rating = rating == n ? 0 : n;
                for (int j = 0; j < 5; j++) all[j].setTextColor(color(j < rating ? R.color.widget_accent : R.color.widget_ring));
            });
            s.setTextColor(color(R.color.widget_ring));
            all[i] = s;
            row.addView(s);
        }
        form.addView(row);
    }

    private void starToggle() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(14);
        TextView t = new TextView(this);
        t.setTextSize(14);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setGravity(Gravity.CENTER_VERTICAL);
        t.setMinHeight(dp(40));
        t.setPadding(dp(14), 0, dp(16), 0);
        t.setCompoundDrawablePadding(dp(6));
        Runnable paint = () -> {
            t.setText(starred ? "Starred" : "Star it");
            int amber = 0xFFE2B23B;
            t.setTextColor(starred ? amber : color(R.color.widget_text));
            android.graphics.drawable.Drawable d = getDrawable(R.drawable.widget_ico_star).mutate();
            d.setTint(starred ? amber : color(R.color.widget_muted));
            d.setBounds(0, 0, dp(18), dp(18));
            t.setCompoundDrawablesRelative(d, null, null, null);
            GradientDrawable b = rounded(color(R.color.widget_button), 999);
            if (starred) b.setStroke(dp(1), amber);
            t.setBackground(b);
        };
        paint.run();
        t.setOnClickListener((v) -> { starred = !starred; paint.run(); });
        form.addView(t, lp);
    }

    private void amountField() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(rounded(color(R.color.widget_button), 14));
        row.setPadding(dp(16), 0, dp(12), 0);
        TextView sym = new TextView(this);
        String s = WidgetStore.str(snap, "currencySymbol");
        sym.setText(s.isEmpty() ? WidgetStore.str(snap, "currency") : s);
        sym.setTextSize(24);
        sym.setTypeface(Typeface.DEFAULT_BOLD);
        sym.setTextColor(color(R.color.widget_muted));
        row.addView(sym);
        amount = new EditText(this);
        amount.setHint("0");
        amount.setTextSize(28);
        amount.setTypeface(Typeface.DEFAULT_BOLD);
        amount.setTextColor(color(R.color.widget_text));
        amount.setHintTextColor(color(R.color.widget_ring));
        amount.setBackground(null);
        amount.setSingleLine(true);
        amount.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amount.setKeyListener(android.text.method.DigitsKeyListener.getInstance("0123456789.,"));
        amount.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        amount.setPadding(dp(8), dp(10), 0, dp(10));
        amount.addTextChangedListener(watcher());
        row.addView(amount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        form.addView(row);
    }

    // ---- adding ----

    private static int indexOf(String k) {
        for (int i = 0; i < KINDS.length; i++) if (KINDS[i].equals(k)) return i;
        return 0;
    }

    private static String val(EditText e) {
        return e == null ? "" : e.getText().toString().trim();
    }

    /** The amount typed, as "12.50"-style text, or null when it isn't one above nought. */
    static String amountOf(String typed) {
        String s = typed == null ? "" : typed.trim().replace(',', '.');
        if (!s.matches("\\d{1,9}(\\.\\d{0,2})?|\\.\\d{1,2}")) return null;
        try {
            double v = Double.parseDouble(s);
            return v > 0 ? s : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private boolean ready() {
        switch (kind) {
            case "entry":
            case "backlog": return !val(title).isEmpty() && !category.isEmpty();
            case "expense": return amountOf(val(amount)) != null;
            case "note": return !val(text).isEmpty();
            default: return !val(text).isEmpty() && !list.isEmpty();
        }
    }

    private void refreshAdd() {
        boolean on = ready();
        addButton.setEnabled(on);
        addButton.setAlpha(on ? 1f : 0.45f);
    }

    /** The queue item for what's on the form; WidgetStore.queueAdd stamps it. */
    JSONObject item() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("kind", kind);
        o.put("id", WidgetStore.newId());
        switch (kind) {
            case "entry":
                o.put("title", val(title)).put("category", category).put("date", date);
                if (rating > 0) o.put("rating", rating);
                if (!val(notes).isEmpty()) o.put("notes", val(notes));
                break;
            case "backlog":
                o.put("title", val(title)).put("category", category);
                if (starred) o.put("starred", true);
                if (!val(notes).isEmpty()) o.put("notes", val(notes));
                break;
            case "expense":
                o.put("amount", amountOf(val(amount))).put("date", date).put("from", "quick");
                if (!val(notes).isEmpty()) o.put("note", val(notes));
                if (!category.isEmpty()) o.put("category", category);
                if (!sub.isEmpty()) o.put("subcategory", sub);
                break;
            case "note":
                o.put("text", val(text));
                if (!val(title).isEmpty()) o.put("title", val(title));
                if (!category.isEmpty()) o.put("category", category);
                break;
            default:
                o.put("list", list).put("text", val(text));
        }
        return o;
    }

    private void add() {
        if (!ready()) return;
        try {
            WidgetStore.queueAdd(this, item());
        } catch (JSONException e) {
            return;
        }
        prefs.edit().putString("quick:cat:" + kind, "item".equals(kind) ? list : category).apply();
        WidgetStore.refreshAll(this);
        WidgetsPlugin.onQueued();
        if ("item".equals(kind)) {
            // A list takes a few at a time: the window stays for the next one.
            added.add(val(text));
            text.setText("");
            addedLine.setText("Added " + String.join(", ", added) + " — syncs when you open LifeLog");
            addedLine.setVisibility(View.VISIBLE);
            prefs.edit().remove("quick:draft:item").apply();
            return;
        }
        forgetDraft();
        Toast.makeText(this, doneText(kind), Toast.LENGTH_SHORT).show();
        finish();
    }

    static String doneText(String kind) {
        switch (kind) {
            case "entry": return "Added to your Timeline — syncs when you open LifeLog";
            case "expense": return "Added to your Ledger — syncs when you open LifeLog";
            case "backlog": return "Added to your Backlog — syncs when you open LifeLog";
            case "note": return "Note saved — syncs when you open LifeLog";
            default: return "Added — syncs when you open LifeLog";
        }
    }

    /** The app's own form, with what's typed carried over (app.js runAction). */
    String fullFormAction() {
        switch (kind) {
            case "entry": return "add-entry" + query("title", val(title));
            case "backlog": return "add-backlog" + query("title", val(title));
            case "note": return "add-note" + query("title", val(title), "text", val(text));
            case "expense": {
                String a = amountOf(val(amount));
                return "add-expense" + query("amount", a == null ? "" : a, "note", val(notes), "date", date);
            }
            default: return list.isEmpty() ? "add-todo" : "add-todo:" + list;
        }
    }

    static String query(String... pairs) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            if (pairs[i + 1] == null || pairs[i + 1].isEmpty()) continue;
            String v;
            try {
                v = java.net.URLEncoder.encode(pairs[i + 1], "UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                continue;
            }
            b.append(b.length() == 0 ? '?' : '&').append(pairs[i]).append('=').append(v);
        }
        return b.toString();
    }

    private void openApp(String action) {
        try {
            startActivity(WidgetStore.launch(this, action));
        } catch (RuntimeException e) {
            // Nothing to open it with.
        }
        finish();
    }

    // ---- what's typed, kept if the window is closed before Add ----

    private JSONObject draft() {
        String s = prefs.getString("quick:draft:" + kind, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    private void keepDraft() {
        try {
            JSONObject d = new JSONObject();
            if (!val(title).isEmpty()) d.put("title", val(title));
            if (!val(text).isEmpty()) d.put("text", val(text));
            if (!val(notes).isEmpty()) d.put("notes", val(notes));
            if (!val(amount).isEmpty()) d.put("amount", val(amount));
            if (d.length() == 0) prefs.edit().remove("quick:draft:" + kind).apply();
            else prefs.edit().putString("quick:draft:" + kind, d.toString()).apply();
        } catch (JSONException e) {
            // Not kept.
        }
    }

    private void forgetDraft() {
        if (title != null) title.setText("");
        if (text != null) text.setText("");
        if (notes != null) notes.setText("");
        if (amount != null) amount.setText("");
        prefs.edit().remove("quick:draft:" + kind).apply();
    }

    // ---- pieces ----

    private TextWatcher watcher() {
        return new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { refreshAdd(); }
        };
    }

    private EditText field(String hintText, boolean multi) {
        EditText e = new EditText(this);
        e.setHint(hintText);
        e.setTextSize(16);
        e.setTextColor(color(R.color.widget_text));
        e.setHintTextColor(color(R.color.widget_muted));
        e.setBackground(rounded(color(R.color.widget_button), 14));
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        e.setMinHeight(dp(48));
        int type = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
        if (multi) {
            e.setInputType(type | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            e.setMaxLines(6);
            e.setGravity(Gravity.TOP | Gravity.START);
        } else {
            e.setInputType(type);
            e.setSingleLine(true);
            e.setImeOptions(EditorInfo.IME_ACTION_DONE);
            e.setOnEditorActionListener((v, id, ev) -> {
                if (id != EditorInfo.IME_ACTION_DONE) return false;
                if (ready()) add();
                return true;
            });
        }
        e.addTextChangedListener(watcher());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(form.getChildCount() == 0 ? 12 : 10);
        form.addView(e, lp);
        return e;
    }

    private void label(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(12);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setAllCaps(true);
        t.setLetterSpacing(0.06f);
        t.setTextColor(color(R.color.widget_muted));
        t.setPadding(dp(4), dp(14), 0, dp(6));
        form.addView(t);
    }

    private TextView hint(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(13);
        t.setTextColor(color(R.color.widget_muted));
        t.setPadding(dp(4), dp(6), dp(4), 0);
        form.addView(t);
        return t;
    }

    interface Pick { void on(String id); }

    /** A scrolling row of chips, one picked. Each option is { id, label, colour }. */
    final class Chips {
        final List<TextView> views = new ArrayList<>();
        final List<String[]> opts;
        final Pick pick;
        int at = -1;

        Chips(List<String[]> opts, Pick pick) {
            this.opts = opts;
            this.pick = pick;
        }

        void select(int i) {
            at = i;
            for (int j = 0; j < views.size(); j++) paint(j, j == i);
        }

        void rename(int i, String label) {
            views.get(i).setText(label);
            select(i);
        }

        void paint(int j, boolean on) {
            TextView v = views.get(j);
            v.setBackground(rounded(color(on ? R.color.widget_accent : R.color.widget_button), 999));
            v.setTextColor(color(on ? R.color.widget_on_accent : R.color.widget_text));
            v.setSelected(on);
            String col = opts.get(j)[2];
            if (col.isEmpty()) {
                v.setCompoundDrawablesRelative(null, null, null, null);
                return;
            }
            GradientDrawable dot = new GradientDrawable();
            dot.setShape(GradientDrawable.OVAL);
            dot.setColor(WidgetStore.parseColor(col, color(R.color.widget_muted)));
            if (on) dot.setStroke(dp(1), color(R.color.widget_on_accent));
            dot.setBounds(0, 0, dp(10), dp(10));
            v.setCompoundDrawablesRelative(dot, null, null, null);
        }
    }

    private Chips chips(List<String[]> opts, String picked, Pick pick) {
        return chips(opts, picked, pick, -1);
    }

    private Chips chips(List<String[]> opts, String picked, Pick pick, int index) {
        Chips c = new Chips(opts, pick);
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        scroll.addView(row);
        int start = 0;
        for (int i = 0; i < opts.size(); i++) {
            int n = i;
            TextView v = new TextView(this);
            v.setText(opts.get(i)[1]);
            v.setTextSize(14);
            v.setGravity(Gravity.CENTER_VERTICAL);
            v.setMinHeight(dp(40));
            v.setPadding(dp(14), 0, dp(14), 0);
            v.setCompoundDrawablePadding(dp(8));
            v.setOnClickListener((x) -> {
                if (!"pick".equals(opts.get(n)[0])) c.select(n);
                pick.on(opts.get(n)[0]);
                refreshAdd();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(dp(6));
            row.addView(v, lp);
            c.views.add(v);
            if (opts.get(i)[0].equals(picked)) start = i;
        }
        c.select(opts.isEmpty() ? -1 : start);
        if (index < 0) form.addView(scroll);
        else form.addView(scroll, index);
        return c;
    }

    private TextView pill(String s, boolean primary) {
        TextView b = new TextView(this);
        b.setText(s);
        b.setTextSize(15);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setGravity(Gravity.CENTER);
        b.setMinHeight(dp(44));
        b.setPadding(dp(20), 0, dp(20), 0);
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

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
