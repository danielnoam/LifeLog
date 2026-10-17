package io.github.danielnoam.lifelog.widgets;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Habit reminders (0.183.0), on this phone only.
 *
 * Each habit's reminder time rides in the widgets' snapshot, so there is one
 * source for both. Rather than an alarm per habit per day, there is one: set
 * for the soonest reminder still to come. When it goes off, every habit whose
 * time has passed since the last check, that is due today and not yet kept,
 * gets a notification — decided then, from the latest snapshot and the
 * widget's own ticks, so a habit kept on the widget, in the app, or on
 * another device that has since synced doesn't buzz. Then the next alarm is
 * set.
 *
 * Inexact (setAndAllowWhileIdle): "around 21:00" is what a habit reminder
 * needs, and it needs no special permission. Rescheduled whenever the app
 * sends a snapshot, and on boot, update and clock changes (ReminderReceiver).
 *
 * The same alarm rings the snapshot's `alerts` (0.272.0): a recurring
 * charge coming up, and what in the Backlog is out today. The app decides
 * each one's day, time and words (alerts.js); here they're only rung.
 */
final class Reminders {

    static final String CHANNEL = "habit_reminders";
    static final String CHANNEL_CHARGES = "charge_reminders";
    static final String CHANNEL_RELEASES = "release_days";
    static final String ACTION_FIRE = "io.github.danielnoam.lifelog.widgets.REMIND";
    static final String ACTION_DONE = "io.github.danielnoam.lifelog.widgets.REMIND_DONE";
    private static final String KEY_LAST = "remind_checked_until";
    private static final String TAG = "habit";
    private static final String TAG_ALERT = "alert";

    private Reminders() {}

    /** When `time` ("HH:mm") falls on `date`, in this phone's time. */
    static long instant(String date, String time) {
        Calendar cal = WidgetStore.dayOf(date);
        if (cal == null || time == null || !time.matches("\\d{2}:\\d{2}")) return -1;
        cal.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time.substring(0, 2)));
        cal.set(Calendar.MINUTE, Integer.parseInt(time.substring(3, 5)));
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    /** The soonest reminder after `now` over the next week, or -1 for none. */
    static long next(JSONObject snap, String today, long now) {
        if (snap == null) return -1;
        JSONArray habits = snap.optJSONArray("habits");
        long best = -1;
        for (int off = 0; habits != null && off <= 7; off++) {
            String day = WidgetStore.addDays(today, off);
            for (int i = 0; i < habits.length(); i++) {
                JSONObject h = habits.optJSONObject(i);
                if (h == null || !WidgetStore.dueOn(h, day)) continue;
                long t = instant(day, WidgetStore.str(h, "remind"));
                if (t > now && (best < 0 || t < best)) best = t;
            }
            if (best > 0) break;
        }
        JSONArray alerts = snap.optJSONArray("alerts");
        for (int i = 0; alerts != null && i < alerts.length(); i++) {
            JSONObject a = alerts.optJSONObject(i);
            if (a == null) continue;
            long t = instant(WidgetStore.str(a, "day"), WidgetStore.str(a, "time"));
            if (t > now && (best < 0 || t < best)) best = t;
        }
        return best;
    }

    /** The alerts whose time falls in (after, upTo], to ring now. */
    static List<JSONObject> alertsDue(JSONObject snap, long after, long upTo) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray alerts = snap == null ? null : snap.optJSONArray("alerts");
        for (int i = 0; alerts != null && i < alerts.length(); i++) {
            JSONObject a = alerts.optJSONObject(i);
            if (a == null) continue;
            long t = instant(WidgetStore.str(a, "day"), WidgetStore.str(a, "time"));
            if (t > after && t <= upTo) out.add(a);
        }
        return out;
    }

    private static PendingIntent firing(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, 900, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * `fromApp`: the app just sent what's true now, so anything earlier today
     * is settled and nothing before this moment should fire late. From boot or
     * a clock change it's left alone, and a reminder missed while the phone
     * was off comes through then.
     */
    static void schedule(Context c, boolean fromApp) {
        long now = System.currentTimeMillis();
        if (fromApp || !WidgetStore.prefs(c).contains(KEY_LAST)) {
            WidgetStore.prefs(c).edit().putLong(KEY_LAST, now).apply();
        }
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = firing(c);
        am.cancel(pi);
        long at = next(WidgetStore.snapshot(c), WidgetStore.today(), now);
        if (at > 0) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    static void fire(Context c) {
        long now = System.currentTimeMillis();
        long last = WidgetStore.prefs(c).getLong(KEY_LAST, now);
        String today = WidgetStore.today();
        for (WidgetStore.Row r : WidgetStore.habitRows(c)) {
            long t = instant(today, r.remind);
            if (t > last && t <= now && !r.done) notify(c, r);
        }
        for (JSONObject a : alertsDue(WidgetStore.snapshot(c), last, now)) notifyAlert(c, a);
        WidgetStore.prefs(c).edit().putLong(KEY_LAST, now).apply();
        schedule(c, false);
    }

    private static void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Habit reminders", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("A nudge at the time you set, for a habit not yet kept today");
        nm.createNotificationChannel(ch);
    }

    private static void ensureAlertChannels(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL_CHARGES) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_CHARGES, "Recurring charges", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("A heads-up before a recurring expense you asked about charges");
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_RELEASES) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_RELEASES, "Release days", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("What in your Backlog is out today");
            nm.createNotificationChannel(ch);
        }
    }

    private static void notifyAlert(Context c, JSONObject a) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureAlertChannels(nm);
        String id = WidgetStore.str(a, "id");
        String channel = "release".equals(WidgetStore.str(a, "kind")) ? CHANNEL_RELEASES : CHANNEL_CHARGES;
        String action = WidgetStore.str(a, "action");
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(c, channel)
            : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.widget_notify)
            .setContentTitle(WidgetStore.str(a, "title"))
            .setContentText(WidgetStore.str(a, "body"))
            .setStyle(new Notification.BigTextStyle().bigText(WidgetStore.str(a, "body")))
            .setAutoCancel(true)
            .setContentIntent(WidgetStore.openAppOn(c, action.isEmpty() ? "open-finance" : action, 960,
                android.net.Uri.parse("lifelog-alert:" + id)));
        nm.notify(TAG_ALERT, idOf(id), b.build());
    }

    static int idOf(String habitId) {
        return habitId.hashCode();
    }

    static String text(WidgetStore.Row r) {
        String left = r.target > 1 && r.value > 0 ? r.value + " of " + r.target + " so far today" : "Still to do today";
        return r.streak > 0 ? left + " — keep your " + r.streak + "-day streak going" : left;
    }

    private static void notify(Context c, WidgetStore.Row r) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(nm);
        int id = idOf(r.id);

        Intent done = new Intent(c, ReminderReceiver.class);
        done.setAction(ACTION_DONE);
        done.putExtra(ListWidget.EXTRA_ID, r.id);
        PendingIntent donePi = PendingIntent.getBroadcast(c, id, done, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(c, CHANNEL)
            : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.widget_notify)
            .setContentTitle(r.text)
            .setContentText(text(r))
            .setColor(r.color)
            .setAutoCancel(true)
            .setContentIntent(WidgetStore.openApp(c, "open-habits", 950))
            .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.widget_notify), "Done", donePi).build());
        nm.notify(TAG, id, b.build());
    }

    /** A reminder still showing for a habit that has since been kept goes. */
    static void clearKept(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        List<WidgetStore.Row> rows = WidgetStore.habitRows(c);
        for (WidgetStore.Row r : rows) if (r.done) nm.cancel(TAG, idOf(r.id));
    }

    /** Whether Android will show them at all — the switch in its own settings. */
    static boolean allowed(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled();
    }
}
