package io.github.danielnoam.lifelog.widgets;

import android.app.Activity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.getcapacitor.JSArray;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Google Drive backups (src/drive.js), drive.file scope: LifeLog sees
 * the files it made and nothing else. Google matches the app by its package
 * name and signing key, so there is no client ID or secret here. The
 * transfers themselves are the page's own fetch; this only gets the token.
 *
 *   authorize({ ask, scopes })  { token }; with ask false it never shows a
 *                         screen and rejects "consent" when one would be
 *                         needed. `scopes` asks for those instead of Drive's
 *                         (Google Calendar, src/gcal.js, read only)
 *   clearToken({ token }) drops Play Services' cached copy of a token Google
 *                         turned down, so the next authorize asks again
 *
 * Waypage's DrivePlugin, without its native uploads: a LifeLog backup is
 * a JSON file of a few MB, not a library zip.
 */
@CapacitorPlugin(name = "Drive")
public class DrivePlugin extends Plugin {

    private static final String SCOPE = "https://www.googleapis.com/auth/drive.file";
    private ActivityResultLauncher<IntentSenderRequest> consent;
    private PluginCall asking;

    @Override
    public void load() {
        consent = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), (result) -> {
            PluginCall call = asking;
            asking = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("Not allowed", "declined");
                return;
            }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                answer(call, r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean ask = call.getBoolean("ask", false);
        List<Scope> scopes = new ArrayList<>();
        JSArray asked = call.getArray("scopes");
        if (asked != null) {
            for (int i = 0; i < asked.length(); i++) {
                String s = asked.optString(i, "");
                if (s.startsWith("https://www.googleapis.com/auth/")) scopes.add(new Scope(s));
            }
        }
        if (scopes.isEmpty()) scopes = Collections.singletonList(new Scope(SCOPE));
        AuthorizationRequest req = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .build();
        Identity.getAuthorizationClient(getActivity()).authorize(req)
            .addOnSuccessListener((r) -> {
                if (!r.hasResolution()) {
                    answer(call, r);
                    return;
                }
                if (!ask || r.getPendingIntent() == null) {
                    call.reject("Needs the account picked", "consent");
                    return;
                }
                if (asking != null) asking.reject("Asked again", "failed");
                asking = call;
                consent.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
            })
            .addOnFailureListener((e) -> call.reject(e.getMessage(), "failed"));
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null) {
            call.resolve();
            return;
        }
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        }).start();
    }

    private void answer(PluginCall call, AuthorizationResult r) {
        String token = r.getAccessToken();
        if (token == null) {
            call.reject("No token", "failed");
            return;
        }
        JSObject out = new JSObject();
        out.put("token", token);
        call.resolve(out);
    }
}
