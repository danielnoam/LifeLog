package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;
import java.util.function.IntFunction;

/**
 * The to-do widget's frame: header, + button, list. (Named for when the
 * habits widget shared it; it has plain rows since 0.184.0.)
 *
 * Drawn whole only when Android asks (onUpdate: placed, rebooted, the app
 * updated). Every other redraw — a tick, a new snapshot from the app — is a
 * partial update of the header plus a data-changed nudge for the list. A
 * whole redraw hands the list a new adapter, which scrolls it back to the
 * top: tick something three categories down and you'd lose your place.
 */
final class ListWidget {

    static final String EXTRA_KIND = "io.github.danielnoam.lifelog.widgets.KIND";
    static final String EXTRA_ID = "io.github.danielnoam.lifelog.widgets.ID";
    /** On a list's heading: the action to open the app with, rather than a tick. */
    static final String EXTRA_OPEN = "io.github.danielnoam.lifelog.widgets.OPEN";

    private ListWidget() {}

    /**
     * The header's text, which is all a partial update touches — in the
     * layout this widget has, full or compact (the compact one keeps the
     * header's views, hidden, so the same update fits both).
     */
    static RemoteViews header(Context c, int layout, String title, String subtitle, String empty) {
        RemoteViews v = new RemoteViews(c.getPackageName(), layout);
        v.setTextViewText(R.id.widget_title, title);
        v.setTextViewText(R.id.widget_subtitle, subtitle == null ? "" : subtitle);
        v.setViewVisibility(R.id.widget_subtitle, subtitle == null || subtitle.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.widget_empty, empty);
        return v;
    }

    static RemoteViews whole(
        Context c,
        int widgetId,
        int layout,
        Class<?> provider,
        String kind,
        String tickAction,
        String title,
        String subtitle,
        String empty,
        String openAction,
        String addAction,
        int requestBase
    ) {
        RemoteViews v = header(c, layout, title, subtitle, empty);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // From Android 12 the rows travel in the update itself.
            v.setRemoteAdapter(R.id.widget_list, TodosWidget.items(c, widgetId));
        } else {
            Intent adapter = new Intent(c, ListService.class);
            adapter.putExtra(EXTRA_KIND, kind);
            adapter.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            // Without distinct data, two widgets of the same kind share one factory.
            adapter.setData(Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME)));
            v.setRemoteAdapter(R.id.widget_list, adapter);
        }
        v.setEmptyView(R.id.widget_list, R.id.widget_empty);

        v.setOnClickPendingIntent(R.id.widget_root, WidgetStore.openApp(c, openAction, requestBase));
        v.setOnClickPendingIntent(R.id.widget_header, WidgetStore.openApp(c, openAction, requestBase));
        v.setOnClickPendingIntent(R.id.widget_empty, WidgetStore.openApp(c, openAction, requestBase));
        // No + when there's no one list for it to add to (0.199.0): each
        // list's heading has its own then.
        v.setViewVisibility(R.id.widget_add, addAction == null ? View.GONE : View.VISIBLE);
        if (addAction != null) {
            v.setOnClickPendingIntent(R.id.widget_add, WidgetStore.openAppOn(c, addAction, requestBase + 1,
                Uri.parse("lifelog-widget://add/" + widgetId)));
        }

        Intent tick = new Intent(c, provider);
        tick.setAction(tickAction);
        PendingIntent template = PendingIntent.getBroadcast(
            c,
            requestBase + 2,
            tick,
            PendingIntent.FLAG_UPDATE_CURRENT | WidgetStore.mutableFlag()
        );
        v.setPendingIntentTemplate(R.id.widget_list, template);
        return v;
    }

    /**
     * Header text and list contents, keeping the list where it's scrolled to.
     * Before 12 that's a partial update and a data-changed nudge for the
     * service; from 12 the new rows ride in the partial update, which hands
     * them to the list's existing adapter rather than replacing it.
     */
    static void refresh(Context c, Class<?> provider, IntFunction<RemoteViews> headerFor) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = ids(c, provider);
        if (ids.length == 0) return;
        boolean inUpdate = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
        for (int id : ids) {
            RemoteViews header = headerFor.apply(id);
            if (inUpdate) header.setRemoteAdapter(R.id.widget_list, TodosWidget.items(c, id));
            manager.partiallyUpdateAppWidget(id, header);
        }
        if (!inUpdate) manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    static int[] ids(Context c, Class<?> provider) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, provider));
    }
}
