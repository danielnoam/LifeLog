package io.github.danielnoam.lifelog.widgets;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Markdown files in a folder picked through Android's own folder screen
 * (0.202.0), for the notes import. The app's WebView has no folder picker
 * (`webkitdirectory` does nothing there), so the folder is walked here and
 * each file handed back as { name, folder, text, lastModified } — `folder`
 * being the subfolder it sits in, "" straight inside the one picked, as
 * webkitRelativePath gives it on a computer.
 */
final class MarkdownFolder {

    static final int MAX_FILES = 3000;
    static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    static final long MAX_TOTAL_BYTES = 40L * 1024 * 1024;
    private static final int MAX_DEPTH = 12;

    private MarkdownFolder() {}

    static boolean isMarkdown(String name) {
        return name != null && name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(md|markdown|txt)$");
    }

    static JSONArray read(ContentResolver cr, Uri tree) throws IOException, JSONException {
        JSONArray out = new JSONArray();
        long[] total = { 0 };
        walk(cr, tree, DocumentsContract.getTreeDocumentId(tree), "", 0, out, total);
        return out;
    }

    private static void walk(ContentResolver cr, Uri tree, String docId, String folder, int depth, JSONArray out, long[] total)
        throws IOException, JSONException {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        };
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext() && out.length() < MAX_FILES) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (depth < MAX_DEPTH) walk(cr, tree, id, name, depth + 1, out, total);
                    continue;
                }
                long size = c.isNull(4) ? 0 : c.getLong(4);
                if (!isMarkdown(name) || size > MAX_FILE_BYTES || total[0] + size > MAX_TOTAL_BYTES) continue;
                String text = readText(cr, DocumentsContract.buildDocumentUriUsingTree(tree, id));
                total[0] += text.length();
                JSONObject f = new JSONObject();
                f.put("name", name);
                f.put("folder", folder);
                f.put("text", text);
                f.put("lastModified", c.isNull(3) ? 0 : c.getLong(3));
                out.put(f);
            }
        }
    }

    private static String readText(ContentResolver cr, Uri doc) throws IOException {
        try (InputStream in = cr.openInputStream(doc)) {
            if (in == null) return "";
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
