package io.github.danielnoam.lifelog.widgets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The reminder alarm, a reminder's Done, and the moments alarms are lost. */
public class ReminderReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        String action = intent.getAction();
        if (Reminders.ACTION_FIRE.equals(action)) {
            Reminders.fire(c);
        } else if (Reminders.ACTION_DONE.equals(action)) {
            WidgetStore.finishHabit(c, intent.getStringExtra(ListWidget.EXTRA_ID));
            // Clears the notification too, now that the habit reads as kept.
            WidgetStore.refreshAll(c);
            WidgetsPlugin.onQueued();
        } else {
            // Boot, an app update, the clock or time zone changing: alarms
            // don't survive the first two and are wrong after the others.
            Reminders.schedule(c, false);
        }
    }
}
