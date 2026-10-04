package io.github.danielnoam.lifelog.widgets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A payment notification's Add (see Payments). */
public class PaymentReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Payments.ACTION_ADD.equals(intent.getAction())) return;
        Payments.add(c, intent);
        WidgetsPlugin.onQueued();
    }
}
