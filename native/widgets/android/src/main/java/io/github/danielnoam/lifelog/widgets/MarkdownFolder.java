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
 *
 * Pictures (0.297.0) come back as { name, folder, path, uri, size, image }
 * without their bytes: a vault can hold gigabytes of them, and only the ones
 * an imported note shows are read, one at a time, through readDocument.
 * `path` is the file's place under the folder picked ("Travel/x.png"), which
 * a note's ![](attachments/x.png) is matched against.
 */
final class MarkdownFolder {

    static final int MAX_FILES = 3000;
    static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    static final long MAX_TOTAL_BYTES = 40L * 1024 * 1024;
    private static final int MAX_DEPTH = 12;

    private MarkdownFolder() {}

    static final int MAX_IMAGES = 20000;
    static final long MAX_IMAGE_BYTES = 40L * 1024 * 1024;

    static boolean isImage(String name) {
        return name != null && name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$");
    }

    static boolean isMarkdown(String name) {
        return name != null && name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.(md|markdown|txt)$");
    }

    static JSONArray read(ContentResolver cr, Uri tree) throws IOException, JSONException {
        JSONArray out = new JSONArray();
        long[] total = { 0 };
        int[] images = { 0 };
        walk(cr, tree, DocumentsContract.getTreeDocumentId(tree), "", "", 0, out, total, images);
        return out;
    }

    private static void walk(ContentResolver cr, Uri tree, String docId, String folder, String rel, int depth, JSONArray out, long[] total, int[] images)
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
            while (c.moveToNext() && out.length() - images[0] < MAX_FILES) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (depth < MAX_DEPTH) walk(cr, tree, id, name, rel + name + "/", depth + 1, out, total, images);
                    continue;
                }
                long size = c.isNull(4) ? 0 : c.getLong(4);
                if (isImage(name)) {
                    if (size > MAX_IMAGE_BYTES || images[0] >= MAX_IMAGES) continue;
                    images[0]++;
                    JSONObject f = new JSONObject();
                    f.put("name", name);
                    f.put("folder", folder);
                    f.put("path", rel + name);
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    f.put("size", size);
                    f.put("image", true);
                    out.put(f);
                    continue;
                }
                if (!isMarkdown(name) || size > MAX_FILE_BYTES || total[0] + size > MAX_TOTAL_BYTES) continue;
                String text = readText(cr, DocumentsContract.buildDocumentUriUsingTree(tree, id));
                total[0] += text.length();
                JSONObject f = new JSONObject();
                f.put("name", name);
                f.put("folder", folder);
                f.put("text", text);
                f.put("path", rel + name);
                f.put("lastModified", c.isNull(3) ? 0 : c.getLong(3));
                out.put(f);
            }
        }
    }

    /** One picture's bytes, for readDocument. Only a document under a folder picked here. */
    static byte[] readBytes(ContentResolver cr, Uri doc) throws IOException {
        String p = doc.getPath();
        if (!"content".equals(doc.getScheme()) || p == null || !p.startsWith("/tree/") || !p.contains("/document/")) {
            throw new IOException("not a picked document");
        }
        try (InputStream in = cr.openInputStream(doc)) {
            if (in == null) throw new IOException("can't open it");
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[65536];
            for (int n; (n = in.read(chunk)) > 0; ) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_IMAGE_BYTES) throw new IOException("it's over 40 MB");
            }
            return buf.toByteArray();
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
