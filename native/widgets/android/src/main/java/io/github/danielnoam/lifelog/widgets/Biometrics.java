package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import android.content.Context;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import java.util.concurrent.Executor;

/**
 * The app lock's fingerprint / face unlock (0.184.0), with Android's own
 * sheet. The browser version uses WebAuthn, which the app's WebView doesn't
 * offer: it only serves sites that can prove they belong to the app, and
 * the app's pages come from https://localhost, which can't.
 *
 * Framework BiometricPrompt, not androidx.biometric: no new dependency, at
 * the cost of needing Android 10 (BiometricManager). Older phones keep the
 * PIN, which is always there regardless — this is a faster way past it,
 * never a replacement for it.
 */
final class Biometrics {

    interface Result {
        /** reason: "ok", "cancelled" (backed out, or chose the PIN), or "error". */
        void done(boolean ok, String reason, String message);
    }

    private Biometrics() {}

    /** "available", "none-enrolled" (the phone can, nothing's set up) or "unsupported". */
    static String state(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "unsupported";
        BiometricManager bm = c.getSystemService(BiometricManager.class);
        if (bm == null) return "unsupported";
        int r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
            : bm.canAuthenticate();
        if (r == BiometricManager.BIOMETRIC_SUCCESS) return "available";
        if (r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "none-enrolled";
        return "unsupported";
    }

    /** Shows the sheet; must be called on the main thread. */
    static void prompt(Activity a, String title, String subtitle, Result result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            result.done(false, "error", "Needs Android 10 or later");
            return;
        }
        Executor main = a.getMainExecutor();
        final boolean[] settled = { false };
        BiometricPrompt.Builder b = new BiometricPrompt.Builder(a)
            .setTitle(title)
            // Face unlock shouldn't need a second tap to confirm: opening the
            // app is the intent.
            .setConfirmationRequired(false)
            .setNegativeButton("Use PIN", main, (dialog, which) -> {
                if (settled[0]) return;
                settled[0] = true;
                result.done(false, "cancelled", "Chose the PIN");
            });
        if (subtitle != null && !subtitle.isEmpty()) b.setSubtitle(subtitle);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        }
        b.build().authenticate(new CancellationSignal(), main, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                if (settled[0]) return;
                settled[0] = true;
                result.done(true, "ok", "");
            }

            @Override
            public void onAuthenticationError(int code, CharSequence message) {
                if (settled[0]) return;
                settled[0] = true;
                boolean backedOut = code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                    || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                    || code == BiometricPrompt.BIOMETRIC_ERROR_NEGATIVE_BUTTON;
                result.done(false, backedOut ? "cancelled" : "error", message == null ? "" : message.toString());
            }
            // onAuthenticationFailed — one finger not recognised — keeps the
            // sheet up for another go; nothing to report yet.
        });
    }
}
