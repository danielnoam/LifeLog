package io.github.danielnoam.lifelog.widgets;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the app working while it's put away (0.244.0), for as long as
 * src/jobs.js has something queued or running: an import, a re-check, a save
 * to GitHub.
 *
 * Android freezes a backgrounded app's process within seconds, WebView and
 * all. A foreground service is the one sanctioned way to stay alive, and it
 * has to show a notification while it runs, so that notification is the
 * progress: what's running, how far along, and a Stop. A partial wake lock
 * keeps the CPU on with the screen off; it times out on its own in case the
 * app dies without releasing it.
 *
 * The app only says what it's busy with (hold) or that it's done (release);
 * the service itself starts as the app is put away (WidgetsPlugin's
 * handleOnPause), while Android still counts it as in front, since from
 * Android 12 one can't be started from the background. With the app in
 * front nothing needs keeping alive, so there's no notification then, and
 * coming back stops it.
 */
public class BackgroundWork extends Service {

    static final String CHANNEL = "background_work";
    static final int NOTIFICATION_ID = 7340;
    static final String ACTION_STOP = "io.github.danielnoam.lifelog.widgets.STOP_WORK";
    private static final long WAKE_LIMIT_MS = 30 * 60 * 1000L;

    private static volatile boolean running = false, busy = false;
    private static String title = "LifeLog", text = "";
    private static int done = 0, total = 0;

    private PowerManager.WakeLock wake;

    /** What the app is busy with; updates the notification if it's showing. */
    static void hold(Context c, String t, String x, int d, int n) {
        busy = true;
        title = t == null || t.isEmpty() ? "LifeLog" : t;
        text = x == null ? "" : x;
        done = d;
        total = n;
        if (running) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, build(c));
        }
    }

    static void release(Context c) {
        busy = false;
        if (running) c.stopService(new Intent(c, BackgroundWork.class));
    }

    /** The app is being put away: keep it working if it's busy. */
    static void onAppPaused(Context c) {
        if (!busy || running) return;
        try {
            Intent i = new Intent(c, BackgroundWork.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception e) {
            // Refused (Android 12+ deciding the app is already in the
            // background): the work carries on when the app is opened again.
        }
    }

    /** Back in front, where nothing needs keeping alive. */
    static void onAppResumed(Context c) {
        if (running) c.stopService(new Intent(c, BackgroundWork.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LifeLog:background-work");
            wake.setReferenceCounted(false);
            wake.acquire(WAKE_LIMIT_MS);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = build(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        running = true;
        if (intent != null && ACTION_STOP.equals(intent.getAction())) WidgetsPlugin.stopWork(this);
        else if (!busy) stopSelf();
        return START_NOT_STICKY;
    }

    /** Android 15 caps a data-sync service at six hours a day; past that, stop. */
    @Override
    public void onTimeout(int startId, int fgsType) {
        WidgetsPlugin.stopWork(this);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Background work", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Shows while an import, a re-check or a sync keeps going with the app put away");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static Notification build(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) ensureChannel(nm);
        Intent stop = new Intent(c, BackgroundWork.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(c, 7341, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(c, CHANNEL)
            : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.widget_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(WidgetStore.openApp(c, "open-activity", 7342))
            .addAction(new Notification.Action.Builder(Icon.createWithResource(c, R.drawable.widget_notify), "Stop", stopPi).build());
        if (total > 0) b.setProgress(total, Math.min(done, total), false);
        else b.setProgress(0, 0, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }
}
