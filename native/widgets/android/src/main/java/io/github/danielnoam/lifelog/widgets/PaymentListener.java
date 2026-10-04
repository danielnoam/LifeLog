package io.github.danielnoam.lifelog.widgets;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Android hands a notification listener every notification on the phone;
 * this one looks only at Google Wallet's, and only while the switch in
 * LifeLog's settings is on (see Payments). Running at all needs notification
 * access, which only the person can give, in Android's own settings.
 */
public class PaymentListener extends NotificationListenerService {

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || !Payments.WALLET.equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null || n.extras == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle x = n.extras;
        CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (text == null) text = x.getCharSequence(Notification.EXTRA_TEXT);
        Payments.onWallet(this, sbn.getKey(), title == null ? null : title.toString(), text == null ? null : text.toString());
    }
}
