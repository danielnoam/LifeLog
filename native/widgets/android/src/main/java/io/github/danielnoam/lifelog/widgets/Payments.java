package io.github.danielnoam.lifelog.widgets;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Google Wallet payments, offered to the Ledger (0.238.0).
 *
 * PaymentListener sees Wallet's notification when you pay with the phone
 * and, if the switch in the app is on, hands it here. LifeLog then posts its
 * own: "₪45.90 · Starbucks — Add to your Ledger?". Add queues the expense the
 * way a widget queues a tick (WidgetStore), so it lands the next time the
 * app runs; tapping the notification opens the add form filled in instead,
 * to change the category or the note first. A payment in another currency
 * only gets the form, which is where its rate is set.
 *
 * Nothing is read from any other app, and nothing leaves the phone.
 */
final class Payments {

    static final String WALLET = "com.google.android.apps.walletnfcrel";
    static final String CHANNEL = "payments";
    static final String ACTION_ADD = "io.github.danielnoam.lifelog.widgets.PAYMENT_ADD";
    private static final String TAG = "payment";
    private static final String KEY_ON = "payments_on";
    private static final String KEY_LAST = "payments_last";
    // Wallet can post the same payment more than once (an update, a second
    // device in the account); the same amount at the same place this soon
    // after is taken to be that, not a second coffee.
    private static final long SAME_WITHIN_MS = 2 * 60 * 1000;

    private Payments() {}

    static boolean isOn(Context c) {
        return WidgetStore.prefs(c).getBoolean(KEY_ON, false);
    }

    static void setOn(Context c, boolean on) {
        WidgetStore.prefs(c).edit().putBoolean(KEY_ON, on).apply();
    }

    /** Whether Android lets PaymentListener see notifications at all. */
    static boolean hasAccess(Context c) {
        String enabled = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        if (enabled == null) return false;
        String mine = new ComponentName(c, PaymentListener.class).flattenToString();
        for (String s : enabled.split(":")) if (mine.equals(s)) return true;
        return false;
    }

    /** Android's page for this one listener where there is one (11 and up), its list before that. */
    static Intent accessSettings(Context c) {
        Intent i;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS);
            i.putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                new ComponentName(c, PaymentListener.class).flattenToString());
        } else {
            i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    static void onWallet(Context c, String key, String title, String text) {
        if (!isOn(c)) return;
        PaymentText.Payment p = PaymentText.parse(title, text);
        if (p == null || seenJustNow(c, p)) return;
        offer(c, p, key == null ? p.shown + p.merchant : key);
    }

    private static synchronized boolean seenJustNow(Context c, PaymentText.Payment p) {
        String print = p.currency + " " + p.amount + " " + p.merchant;
        long now = System.currentTimeMillis();
        String last = WidgetStore.prefs(c).getString(KEY_LAST, "");
        int bar = last.indexOf('|');
        if (bar > 0 && print.equals(last.substring(bar + 1))) {
            try {
                if (now - Long.parseLong(last.substring(0, bar)) < SAME_WITHIN_MS) return true;
            } catch (NumberFormatException e) {
                // Unreadable; treat it as new.
            }
        }
        WidgetStore.prefs(c).edit().putString(KEY_LAST, now + "|" + print).apply();
        return false;
    }

    private static void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Payments to add", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("A Google Wallet payment, with a button to add it to your Ledger");
        nm.createNotificationChannel(ch);
    }

    /** What the add form opens with: the same query an iOS Shortcut can send. */
    static String formAction(String amount, String currency, String note, String date) {
        return "add-expense?amount=" + Uri.encode(amount) + "&currency=" + Uri.encode(currency)
            + "&date=" + Uri.encode(date) + (note.isEmpty() ? "" : "&note=" + Uri.encode(note));
    }

    private static Notification.Builder builder(Context c) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
    }

    private static void offer(Context c, PaymentText.Payment p, String key) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(nm);
        int id = key.hashCode();
        String today = WidgetStore.today();
        JSONObject snap = WidgetStore.snapshot(c);
        String home = snap == null ? "" : WidgetStore.str(snap, "currency");
        boolean canAdd = p.currency.equals(home);

        Notification.Builder b = builder(c)
            .setSmallIcon(R.drawable.widget_notify)
            .setContentTitle(p.merchant.isEmpty() ? p.shown : p.shown + " · " + p.merchant)
            .setContentText(canAdd ? "Add it to your Ledger?" : "Tap to add it to your Ledger, with its rate")
            .setAutoCancel(true)
            .setContentIntent(WidgetStore.openApp(c, formAction(p.amount, p.currency, p.merchant, today), id));
        if (canAdd) {
            Intent add = new Intent(c, PaymentReceiver.class);
            add.setAction(ACTION_ADD);
            add.putExtra("nid", id);
            add.putExtra("amount", p.amount);
            add.putExtra("shown", p.shown);
            add.putExtra("note", p.merchant);
            add.putExtra("date", today);
            PendingIntent addPi = PendingIntent.getBroadcast(c, id, add, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.widget_notify), "Add", addPi).build());
        }
        nm.notify(TAG, id, b.build());
    }

    /** The notification's Add: queued for the app, and a moment's word that it was. */
    static void add(Context c, Intent i) {
        String amount = i.getStringExtra("amount");
        String date = i.getStringExtra("date");
        if (amount == null || date == null) return;
        String note = i.getStringExtra("note");
        WidgetStore.queueExpense(c, UUID.randomUUID().toString(), date, amount, note == null ? "" : note);

        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        int id = i.getIntExtra("nid", 0);
        String shown = i.getStringExtra("shown");
        Notification.Builder b = builder(c)
            .setSmallIcon(R.drawable.widget_notify)
            .setContentTitle("Added " + (shown == null ? amount : shown) + (note == null || note.isEmpty() ? "" : " · " + note))
            .setContentText("It reaches your Ledger when LifeLog next opens")
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(WidgetStore.openApp(c, "open-finance", id));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(6000);
        nm.notify(TAG, id, b.build());
    }
}
