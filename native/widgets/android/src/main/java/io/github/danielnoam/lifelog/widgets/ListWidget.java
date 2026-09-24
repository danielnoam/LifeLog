package io.github.danielnoam.lifelog.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

/**
 * The frame the habits and to-do widgets share: header, + button, list.
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

    private ListWidget() {}

    /** The header's text, which is all a partial update touches. */
    static RemoteViews header(Context c, String title, String subtitle, String empty) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_list);
        v.setTextViewText(R.id.widget_title, title);
        v.setTextViewText(R.id.widget_subtitle, subtitle == null ? "" : subtitle);
        v.setViewVisibility(R.id.widget_subtitle, subtitle == null || subtitle.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.widget_empty, empty);
        return v;
    }

    static RemoteViews whole(
        Context c,
        int widgetId,
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
        RemoteViews v = header(c, title, subtitle, empty);

        Intent adapter = new Intent(c, ListService.class);
        adapter.putExtra(EXTRA_KIND, kind);
        adapter.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        // Without distinct data, two widgets of the same kind share one factory.
        adapter.setData(Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.widget_list, adapter);
        v.setEmptyView(R.id.widget_list, R.id.widget_empty);

        v.setOnClickPendingIntent(R.id.widget_header, WidgetStore.openApp(c, openAction, requestBase));
        v.setOnClickPendingIntent(R.id.widget_empty, WidgetStore.openApp(c, openAction, requestBase));
        v.setOnClickPendingIntent(R.id.widget_add, WidgetStore.openApp(c, addAction, requestBase + 1));

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

    /** Header text and list contents, keeping the list where it's scrolled to. */
    static void refresh(Context c, Class<?> provider, RemoteViews header) {
        AppWidgetManager manager = AppWidgetManager.getInstance(c);
        int[] ids = ids(c, provider);
        if (ids.length == 0) return;
        manager.partiallyUpdateAppWidget(ids, header);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    /** Only the header — for the moment a checkbox is animating in the list. */
    static void refreshHeader(Context c, Class<?> provider, RemoteViews header) {
        int[] ids = ids(c, provider);
        if (ids.length > 0) AppWidgetManager.getInstance(c).partiallyUpdateAppWidget(ids, header);
    }

    static int[] ids(Context c, Class<?> provider) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, provider));
    }
}
