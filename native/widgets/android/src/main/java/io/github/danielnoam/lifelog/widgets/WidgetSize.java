package io.github.danielnoam.lifelog.widgets;

import android.appwidget.AppWidgetManager;
import android.os.Bundle;

/**
 * A widget's size as the launcher reports it, in dp (0.189.0). Each widget
 * picks a compact layout of its own below some size rather than squeezing
 * the big one. Portrait's numbers — the narrower width, the taller height —
 * since that's how a phone's home screen is mostly seen. Zero means the
 * launcher hasn't said, and every widget treats that as roomy.
 *
 * Read on every draw and redrawn on resize (onAppWidgetOptionsChanged),
 * which works the same on every Android the app supports. Android 12's
 * size-keyed RemoteViews would pick for itself, but the to-do list's
 * partial updates, which keep its scroll, can't target one size of those.
 */
final class WidgetSize {

    final int width;
    final int height;

    WidgetSize(int width, int height) {
        this.width = width;
        this.height = height;
    }

    static WidgetSize of(AppWidgetManager manager, int widgetId) {
        Bundle o = manager.getAppWidgetOptions(widgetId);
        if (o == null) return new WidgetSize(0, 0);
        return new WidgetSize(
            o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH),
            o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT));
    }
}
