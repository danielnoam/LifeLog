package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * One note you picked when placing it (0.199.0), tapping through to it in
 * the app. Picked in NotePickActivity, and picked again from there if the
 * note is deleted. The app always sends the pinned notes, whatever its
 * budget for the rest (WidgetsPlugin.notePins), so a note missing from the
 * snapshot really has gone.
 */
public class NoteWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager manager, int[] ids) {
        for (int id : ids) draw(c, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager manager, int id, Bundle options) {
        draw(c, manager, id);
    }

    @Override
    public void onDeleted(Context c, int[] ids) {
        for (int id : ids) WidgetStore.dropConfig(c, id);
    }

    static void refresh(Context c) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        for (int id : ListWidget.ids(c, NoteWidget.class)) draw(c, manager, id);
    }

    /** The note ids placed widgets are showing, for the app to always send. */
    static List<String> pins(Context c) {
        List<String> out = new ArrayList<>();
        for (int id : ListWidget.ids(c, NoteWidget.class)) {
            JSONObject cfg = WidgetStore.config(c, id);
            String note = cfg == null ? "" : WidgetStore.str(cfg, "note");
            if (!note.isEmpty() && !out.contains(note)) out.add(note);
        }
        return out;
    }

    static void draw(Context c, AppWidgetManager manager, int widgetId) {
        JSONObject cfg = WidgetStore.config(c, widgetId);
        String noteId = cfg == null ? "" : WidgetStore.str(cfg, "note");
        JSONArray notes = WidgetStore.notes(WidgetStore.snapshot(c));
        JSONObject note = WidgetStore.noteById(notes, noteId);
        if (note != null) {
            PendingIntent open = WidgetStore.openAppOn(c, "open-note:" + noteId, 500,
                Uri.parse("lifelog-widget://note/" + widgetId));
            manager.updateAppWidget(widgetId, NoteCard.build(c, WidgetSize.of(manager, widgetId), note, true, open, null));
            return;
        }
        String text = notes == null ? "Open LifeLog once to bring your notes here"
            : noteId.isEmpty() ? "Tap to choose a note"
            : "This note has been deleted — tap to choose another";
        PendingIntent tap = notes == null ? WidgetStore.openApp(c, null, 501) : pick(c, widgetId);
        manager.updateAppWidget(widgetId, NoteCard.message(c, "NOTE", text, tap));
    }

    /** Opens the picker for this widget, as Android does when it's placed. */
    private static PendingIntent pick(Context c, int widgetId) {
        Intent i = new Intent(c, NotePickActivity.class);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        i.setData(Uri.parse("lifelog-widget://pick/" + widgetId));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, 502, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
