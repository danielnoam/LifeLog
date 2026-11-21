package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * What Health Connect opens when someone asks why LifeLog wants their health
 * data (its "privacy policy" link; Android 14's permission usage screen
 * through the activity-alias in the manifest). It hands over to the privacy
 * page in the browser, which has a Health Connect section, and goes away.
 */
public class HealthRationaleActivity extends Activity {

    static final String PRIVACY = "https://danielnoam.github.io/LifeLog/privacy.html#health-connect";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            // No browser: nothing else to show.
        }
        finish();
    }
}
