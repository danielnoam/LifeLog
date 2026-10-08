package io.github.danielnoam.lifelog.widgets;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

/**
 * Share into LifeLog (0.250.0): what another app's Share sheet sends, an
 * ACTION_SEND intent with text, becomes the "share?title=…&text=…" action
 * src/share.js reads, the same string the installed web app gets from its
 * share_target. Only the strings, so it runs in the JVM tests.
 */
final class ShareIntent {
    private ShareIntent() {}

    /** Null when there's nothing to share. */
    static String actionOf(String subject, String text) {
        String s = subject == null ? "" : subject.trim();
        String t = text == null ? "" : text.trim();
        if (s.isEmpty() && t.isEmpty()) return null;
        StringBuilder q = new StringBuilder("share?");
        if (!s.isEmpty()) q.append("title=").append(encode(s));
        if (!t.isEmpty()) {
            if (!s.isEmpty()) q.append('&');
            q.append("text=").append(encode(t));
        }
        return q.toString();
    }

    private static String encode(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); }
        catch (UnsupportedEncodingException e) { return ""; }
    }
}
