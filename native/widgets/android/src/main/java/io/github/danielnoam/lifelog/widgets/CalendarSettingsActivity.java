package io.github.danielnoam.lifelog.widgets;

import android.Manifest;
import android.appwidget.AppWidgetManager;
import android.view.View;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Calendar widget's settings (Nov 2026): agenda or month, and whether
 * the events are LifeLog's Google Calendar connection's or the phone's own
 * calendars. Choosing the phone's asks for the calendar permission there
 * and then; turned down, the widget says so until it's allowed. In the
 * app's language, from the words it sent (widgets.js calendarSnapshot).
 */
public class CalendarSettingsActivity extends SettingsScreen {

    private RadioGroup layout, source;

    @Override
    protected void build() {
        JSONObject snap = WidgetStore.snapshot(this);
        JSONObject cal = snap == null ? null : snap.optJSONObject("calendar");
        if (cal != null && cal.optBoolean("rtl")) getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        setTitle(CalendarWidget.word(cal, "settings", "Calendar widget"));

        heading(CalendarWidget.word(cal, "layout", "Layout"));
        layout = radios(CalendarWidget.MONTH.equals(CalendarWidget.layoutOf(was)) ? 2 : 1,
            CalendarWidget.word(cal, "agenda", "Agenda: today and the days ahead"),
            CalendarWidget.word(cal, "month", "Month: the whole month, with marks"));

        heading(CalendarWidget.word(cal, "source", "Calendars"));
        hint(CalendarWidget.word(cal, "sourceHint", "This phone's calendars are read on the phone and never leave it. They're always up to date and include every account on the phone. LifeLog's connection is only as fresh as the last time the app ran."));
        source = radios(CalendarWidget.PHONE.equals(CalendarWidget.sourceOf(was)) ? 2 : 1,
            CalendarWidget.word(cal, "sourceApp", "LifeLog's Google Calendar connection"),
            CalendarWidget.word(cal, "sourcePhone", "This phone's calendars"));
        source.setOnCheckedChangeListener((group, checked) -> {
            if (checked == 2 && !PhoneCalendar.allowed(this)) requestPermissions(new String[] { Manifest.permission.READ_CALENDAR }, 1);
        });
    }

    private RadioGroup radios(int on, String... labels) {
        RadioGroup g = new RadioGroup(this);
        for (int i = 0; i < labels.length; i++) {
            RadioButton r = new RadioButton(this);
            r.setId(i + 1);
            r.setText(labels[i]);
            r.setTextColor(color(R.color.widget_text));
            r.setMinHeight(dp(48));
            g.addView(r);
        }
        g.check(on);
        box.addView(g);
        return g;
    }

    @Override
    protected void collect(JSONObject out) throws JSONException {
        out.put("layout", layout.getCheckedRadioButtonId() == 2 ? CalendarWidget.MONTH : CalendarWidget.AGENDA);
        out.put("source", source.getCheckedRadioButtonId() == 2 ? CalendarWidget.PHONE : CalendarWidget.APP);
        out.put("shift", 0);
    }

    @Override
    protected void redraw(AppWidgetManager manager) {
        manager.updateAppWidget(widgetId, CalendarWidget.build(this, manager, widgetId));
    }
}
