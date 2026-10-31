package app.echo.finance.agent;

import android.content.Context;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * The offline speech model used to spot the wake word. It's ~37 MB, so it
 * is downloaded once on first use instead of shipping inside the APK.
 */
final class VoskModel {

    /** Small Indian-English model: good with Indian accents and Hinglish names. */
    static final String NAME = "vosk-model-small-en-in-0.4";
    private static final String URL_STRING = "https://alphacephei.com/vosk/models/" + NAME + ".zip";

    interface Progress {
        void onProgress(int percent);
    }

    private VoskModel() {}

    static File dir(Context context) {
        return new File(new File(context.getFilesDir(), "vosk"), NAME);
    }

    static boolean isReady(Context context) {
        return new File(dir(context), "am/final.mdl").isFile();
    }

    /** Returns the model directory, downloading and unpacking it first if needed. Blocking. */
    static File ensure(Context context, Progress progress) throws IOException {
        File target = dir(context);
        if (isReady(context)) return target;

        File root = target.getParentFile();
        File staging = new File(root, NAME + ".partial");
        deleteRecursively(staging);
        if (!staging.mkdirs()) throw new IOException("Can't create " + staging);

        HttpURLConnection conn = (HttpURLConnection) new URL(URL_STRING).openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(30_000);
        try {
            if (conn.getResponseCode() != 200) {
                throw new IOException("Model download failed: HTTP " + conn.getResponseCode());
            }
            long total = conn.getContentLengthLong();
            try (InputStream raw = new CountingStream(conn.getInputStream(), total, progress);
                 ZipInputStream zip = new ZipInputStream(raw)) {
                unzip(zip, staging);
            }
        } finally {
            conn.disconnect();
        }

        // The archive holds a single top-level folder named after the model.
        File unpacked = new File(staging, NAME);
        if (!new File(unpacked, "am/final.mdl").isFile()) {
            deleteRecursively(staging);
            throw new IOException("Model archive is incomplete");
        }
        deleteRecursively(target);
        if (!unpacked.renameTo(target)) throw new IOException("Can't move model into place");
        deleteRecursively(staging);
        return target;
    }

    private static void unzip(ZipInputStream zip, File dest) throws IOException {
        String destPath = dest.getCanonicalPath() + File.separator;
        byte[] buf = new byte[64 * 1024];
        ZipEntry entry;
        while ((entry = zip.getNextEntry()) != null) {
            File out = new File(dest, entry.getName());
            // Refuse entries that would escape the destination ("zip slip").
            if (!out.getCanonicalPath().startsWith(destPath)) {
                throw new IOException("Bad zip entry: " + entry.getName());
            }
            if (entry.isDirectory()) {
                out.mkdirs();
                continue;
            }
            File parent = out.getParentFile();
            if (parent != null) parent.mkdirs();
            try (OutputStream os = new FileOutputStream(out)) {
                int n;
                while ((n = zip.read(buf)) > 0) os.write(buf, 0, n);
            }
        }
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** Reports download progress as bytes are read. */
    private static final class CountingStream extends InputStream {
        private final InputStream in;
        private final long total;
        private final Progress progress;
        private long read;
        private int lastPercent = -1;

        CountingStream(InputStream in, long total, Progress progress) {
            this.in = in;
            this.total = total;
            this.progress = progress;
        }

        private void count(long n) {
            if (n <= 0 || total <= 0 || progress == null) return;
            read += n;
            int percent = (int) Math.min(100, read * 100 / total);
            if (percent != lastPercent) {
                lastPercent = percent;
                progress.onProgress(percent);
            }
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) count(1);
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n = in.read(b, off, len);
            count(n);
            return n;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
