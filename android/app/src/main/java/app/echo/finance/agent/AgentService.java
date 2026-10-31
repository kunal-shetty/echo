package app.echo.finance.agent;

import android.Manifest;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.webkit.CookieManager;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

/**
 * The always-on voice agent.
 *
 * A foreground service (so Android lets it keep the microphone) that runs
 * an offline Vosk recogniser over the mic and waits for the agent's name.
 * When it hears it, it vibrates, records one command, sends it to
 * /api/agent/turn with the app's session cookie, then speaks the reply,
 * vibrates the outcome and posts a notification. Nothing leaves the phone
 * until the name is heard.
 */
public class AgentService extends Service {

    public static final String ACTION_START = "app.echo.finance.agent.START";
    public static final String ACTION_STOP = "app.echo.finance.agent.STOP";
    public static final String ACTION_PAUSE = "app.echo.finance.agent.PAUSE";
    public static final String ACTION_RESUME = "app.echo.finance.agent.RESUME";
    public static final String ACTION_CALIBRATE = "app.echo.finance.agent.CALIBRATE";
    public static final String ACTION_RECONFIGURE = "app.echo.finance.agent.RECONFIGURE";

    /** Receives agent events; the Capacitor plugin forwards them to the web app. */
    public interface Listener {
        void onAgentState(String state, String detail);

        void onAgentWake();

        void onAgentHeard(String text);

        void onAgentTurn(JSONObject reply);
    }

    static volatile Listener listener;
    private static volatile boolean active;
    private static volatile String state = "off";
    private static volatile String detail = "";

    private static final String TAG = "EchoAgent";
    private static final int SAMPLE_RATE = 16_000;
    /** 100 ms of 16-bit mono audio. */
    private static final int CHUNK = SAMPLE_RATE / 10;
    /** Minimum loudness counted as speech, in 16-bit RMS. */
    private static final double MIN_SPEECH_RMS = 600;
    private static final long END_SILENCE_MS = 1_200;
    private static final long NO_SPEECH_TIMEOUT_MS = 5_000;
    private static final long MAX_COMMAND_MS = 12_000;
    /** Skip the start of the recording so the "go ahead" tone isn't sent. */
    private static final long SKIP_AFTER_TONE_MS = 200;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean paused;
    private volatile boolean calibrating;
    private volatile boolean speaking;
    private volatile WakeWordMatcher matcher;
    private double noiseRms = MIN_SPEECH_RMS / 3;
    private AgentPrefs prefs;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private Thread worker;

    public static boolean isActive() {
        return active;
    }

    public static String state() {
        return state;
    }

    public static String detail() {
        return detail;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = new AgentPrefs(this);
        AgentNotifications.createChannels(this);
        rebuildMatcher();
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int lang = tts.setLanguage(new Locale("en", "IN"));
            if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.ENGLISH);
            }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    speaking = false;
                }

                @Override
                public void onError(String id) {
                    speaking = false;
                }
            });
            ttsReady = true;
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null || intent.getAction() == null ? ACTION_START : intent.getAction();

        if (ACTION_STOP.equals(action)) {
            prefs.setEnabled(false);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action) && !active) {
            // A control message for an agent that isn't running.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!goForeground()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        active = true;

        switch (action) {
            case ACTION_PAUSE:
                paused = true;
                setState("paused", "Paused while the app uses the mic");
                break;
            case ACTION_RESUME:
                paused = false;
                break;
            case ACTION_CALIBRATE:
                calibrating = true;
                setState("calibrating", "Say “" + prefs.name() + "”");
                break;
            case ACTION_RECONFIGURE:
                rebuildMatcher();
                if ("listening".equals(state)) setState("listening", listeningDetail());
                break;
            default:
                break;
        }

        if (running.compareAndSet(false, true)) {
            worker = new Thread(this::loop, "echo-agent");
            worker.start();
        }
        // Restarted by the system after being killed: try to come back. If
        // Android won't allow the mic from the background, goForeground()
        // above fails and we ask the user to reopen the app instead.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running.set(false);
        active = false;
        if (worker != null) worker.interrupt();
        if (tts != null) tts.shutdown();
        setState("off", "");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ------------------------------------------------------------------
    // Foreground + state
    // ------------------------------------------------------------------

    private boolean goForeground() {
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                : 0;
            ServiceCompat.startForeground(this, AgentNotifications.ONGOING_ID,
                AgentNotifications.ongoing(this, prefs.name(), statusText()), type);
            return true;
        } catch (RuntimeException e) {
            // Android 12+ refuses to start a microphone service while the app
            // is in the background (e.g. after the system killed us).
            Log.w(TAG, "Can't start in the foreground", e);
            AgentNotifications.result(this, prefs.name() + " is asleep",
                "Open Echo to start listening again.");
            return false;
        }
    }

    private void rebuildMatcher() {
        matcher = new WakeWordMatcher(prefs.name(), prefs.aliases());
    }

    private String listeningDetail() {
        return "Say “" + prefs.name() + "”";
    }

    private String statusText() {
        switch (state) {
            case "listening":
                return "Listening for “" + prefs.name() + "”";
            case "awake":
                return "Listening…";
            case "thinking":
                return "Thinking…";
            case "paused":
                return "Paused";
            case "downloading":
                return "Getting ready (" + detail + ")";
            default:
                return "Starting…";
        }
    }

    private void setState(String newState, String newDetail) {
        state = newState;
        detail = newDetail == null ? "" : newDetail;
        Listener l = listener;
        if (l != null) l.onAgentState(state, detail);
        if (active && !"off".equals(newState) && !"error".equals(newState)) {
            AgentNotifications.update(this, prefs.name(), statusText());
        }
    }

    // ------------------------------------------------------------------
    // Wake-word loop
    // ------------------------------------------------------------------

    private void loop() {
        Model model = null;
        Recognizer recognizer = null;
        AudioRecord mic = null;
        try {
            setState("preparing", VoskModel.isReady(this) ? "Loading" : "Downloading speech model");
            File dir = VoskModel.ensure(this, percent -> setState("downloading", percent + "%"));
            model = new Model(dir.getAbsolutePath());
            recognizer = new Recognizer(model, SAMPLE_RATE);

            short[] buf = new short[CHUNK];
            boolean wasSpeaking = false;
            while (running.get()) {
                if (paused) {
                    // Release the mic so the in-app voice sheet can use it.
                    if (mic != null) {
                        releaseMic(mic);
                        mic = null;
                    }
                    SystemClock.sleep(200);
                    continue;
                }
                if (mic == null) {
                    mic = openMic();
                    if (mic == null) {
                        setState("error", "The microphone is busy or not allowed.");
                        SystemClock.sleep(3_000);
                        continue;
                    }
                    recognizer.reset();
                    setState("listening", listeningDetail());
                }

                int n = mic.read(buf, 0, buf.length);
                if (n <= 0) continue;

                // Ignore our own voice while the reply is being spoken.
                if (speaking) {
                    wasSpeaking = true;
                    continue;
                }
                if (wasSpeaking) {
                    wasSpeaking = false;
                    recognizer.reset();
                }

                double rms = rms(buf, n);
                boolean done = recognizer.acceptWaveForm(buf, n);
                String text = done
                    ? field(recognizer.getResult(), "text")
                    : field(recognizer.getPartialResult(), "partial");
                if (!done && text.isEmpty()) noiseRms = noiseRms * 0.95 + rms * 0.05;

                if (calibrating) {
                    if (done && !text.isEmpty()) {
                        calibrating = false;
                        setState("listening", listeningDetail());
                        Listener l = listener;
                        if (l != null) l.onAgentHeard(text);
                    }
                    continue;
                }

                if (!text.isEmpty() && matcher.matches(text)) {
                    recognizer.reset();
                    handleCommand(mic);
                    recognizer.reset();
                    if (running.get() && !paused) setState("listening", listeningDetail());
                }
            }
        } catch (IOException e) {
            Log.w(TAG, "Speech model unavailable", e);
            setState("error", "Couldn't download the speech model. Check your connection and try again.");
            main.post(this::stopSelf);
        } catch (RuntimeException e) {
            Log.e(TAG, "Agent loop crashed", e);
            setState("error", "Something went wrong. Turn the agent off and on again.");
            main.post(this::stopSelf);
        } finally {
            if (mic != null) releaseMic(mic);
            if (recognizer != null) recognizer.close();
            if (model != null) model.close();
            running.set(false);
        }
    }

    private AudioRecord openMic() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        int min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT);
        try {
            AudioRecord rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, CHUNK * 2 * 4));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                rec.release();
                return null;
            }
            rec.startRecording();
            return rec;
        } catch (SecurityException | IllegalStateException e) {
            Log.w(TAG, "Can't open the microphone", e);
            return null;
        }
    }

    private static void releaseMic(AudioRecord mic) {
        try {
            mic.stop();
        } catch (IllegalStateException ignored) {
            // Already stopped.
        }
        mic.release();
    }

    // ------------------------------------------------------------------
    // One command
    // ------------------------------------------------------------------

    private void handleCommand(AudioRecord mic) {
        Listener l = listener;
        if (l != null) l.onAgentWake();
        AgentHaptics.play(this, AgentHaptics.WAKE);
        playGoAheadTone();
        setState("awake", "Listening…");

        byte[] pcm = recordCommand(mic);
        if (pcm == null) {
            deliver(localReply("I'm here, but I didn't hear anything.", "warning"));
            return;
        }

        setState("thinking", "Thinking…");
        try {
            deliver(sendTurn(wav(pcm)));
        } catch (TurnFailed e) {
            deliver(localReply(e.getMessage(), "error"));
        } catch (IOException e) {
            Log.w(TAG, "Agent request failed", e);
            deliver(localReply("I can't reach Echo right now. Check your connection.", "error"));
        }
    }

    /** Records until the user stops talking. Returns null if they never started. */
    private byte[] recordCommand(AudioRecord mic) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(SAMPLE_RATE * 2 * 6);
        short[] buf = new short[CHUNK];
        double threshold = Math.max(MIN_SPEECH_RMS, noiseRms * 3);
        long start = SystemClock.elapsedRealtime();
        long lastVoice = 0;
        boolean heard = false;

        while (running.get() && !paused) {
            int n = mic.read(buf, 0, buf.length);
            if (n <= 0) continue;
            long now = SystemClock.elapsedRealtime();
            if (now - start < SKIP_AFTER_TONE_MS) continue;

            for (int i = 0; i < n; i++) {
                out.write(buf[i] & 0xff);
                out.write((buf[i] >> 8) & 0xff);
            }
            if (rms(buf, n) > threshold) {
                heard = true;
                lastVoice = now;
            }
            if (heard && now - lastVoice > END_SILENCE_MS) break;
            if (!heard && now - start > NO_SPEECH_TIMEOUT_MS) break;
            if (now - start > MAX_COMMAND_MS) break;
        }
        return heard ? out.toByteArray() : null;
    }

    private void playGoAheadTone() {
        try {
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 40);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 120);
            main.postDelayed(tone::release, 400);
        } catch (RuntimeException ignored) {
            // No tone is fine; the vibration already told the user.
        }
    }

    private JSONObject localReply(String spoken, String haptic) {
        JSONObject reply = new JSONObject();
        try {
            reply.put("action", "none");
            reply.put("spoken", spoken);
            reply.put("haptic", haptic);
            reply.put("notification", new JSONObject().put("title", prefs.name()).put("body", spoken));
        } catch (JSONException ignored) {
            // Keys and values are plain strings.
        }
        return reply;
    }

    private void deliver(JSONObject reply) {
        String spoken = reply.optString("spoken", "");
        AgentHaptics.play(this, AgentHaptics.forKind(reply.optString("haptic", "success")));
        JSONObject n = reply.optJSONObject("notification");
        if (n != null) {
            AgentNotifications.result(this, n.optString("title", prefs.name()), n.optString("body", spoken));
        }
        speak(spoken);
        Listener l = listener;
        if (l != null) l.onAgentTurn(reply);
    }

    private void speak(String text) {
        if (!ttsReady || text.isEmpty()) return;
        speaking = true;
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "echo-" + SystemClock.elapsedRealtime())
            != TextToSpeech.SUCCESS) {
            speaking = false;
        }
    }

    // ------------------------------------------------------------------
    // Networking
    // ------------------------------------------------------------------

    /** The server answered with an error the user should hear. */
    private static final class TurnFailed extends Exception {
        TurnFailed(String message) {
            super(message);
        }
    }

    private JSONObject sendTurn(byte[] wav) throws IOException, TurnFailed {
        String base = prefs.serverUrl();
        if (base == null) throw new TurnFailed("Open Echo once so I can find the server.");

        String boundary = "EchoAgent" + System.nanoTime();
        HttpURLConnection conn = (HttpURLConnection) new URL(base + "/api/agent/turn").openConnection();
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(45_000);
        conn.setDoOutput(true);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        String cookie = sessionCookie(base);
        if (cookie != null) conn.setRequestProperty("Cookie", cookie);

        try {
            try (OutputStream os = conn.getOutputStream()) {
                writeField(os, boundary, "language", "en");
                writeField(os, boundary, "name", prefs.name());
                os.write(("--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"command.wav\"\r\n"
                    + "Content-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                os.write(wav);
                os.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            }

            int code = conn.getResponseCode();
            InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = is == null ? "" : readAll(is);
            JSONObject json;
            try {
                json = new JSONObject(text);
            } catch (JSONException e) {
                json = new JSONObject();
            }
            if (code != 200) {
                if (code == 429) throw new TurnFailed("I'm getting a lot of requests. Give me a minute.");
                throw new TurnFailed(json.optString("error", "Something went wrong (" + code + ")."));
            }
            return json;
        } finally {
            conn.disconnect();
        }
    }

    /** The WebView's cookies for the server, so the agent acts as the signed-in user. */
    private String sessionCookie(String base) {
        FutureTask<String> task = new FutureTask<>(() -> CookieManager.getInstance().getCookie(base));
        main.post(task);
        try {
            return task.get(2, TimeUnit.SECONDS);
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeField(OutputStream os, String boundary, String name, String value) throws IOException {
        os.write(("--" + boundary + "\r\n"
            + "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
            + value + "\r\n").getBytes(StandardCharsets.UTF_8));
    }

    private static String readAll(InputStream is) throws IOException {
        try (InputStream in = is) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    // ------------------------------------------------------------------
    // Audio helpers
    // ------------------------------------------------------------------

    private static double rms(short[] buf, int n) {
        double sum = 0;
        for (int i = 0; i < n; i++) sum += (double) buf[i] * buf[i];
        return Math.sqrt(sum / Math.max(1, n));
    }

    private static String field(String json, String key) {
        try {
            return new JSONObject(json).optString(key, "").trim();
        } catch (JSONException e) {
            return "";
        }
    }

    /** Wraps 16 kHz mono 16-bit PCM in a WAV header. */
    static byte[] wav(byte[] pcm) {
        int byteRate = SAMPLE_RATE * 2;
        ByteArrayOutputStream out = new ByteArrayOutputStream(pcm.length + 44);
        writeAscii(out, "RIFF");
        writeInt(out, 36 + pcm.length);
        writeAscii(out, "WAVE");
        writeAscii(out, "fmt ");
        writeInt(out, 16);
        writeShort(out, 1); // PCM
        writeShort(out, 1); // mono
        writeInt(out, SAMPLE_RATE);
        writeInt(out, byteRate);
        writeShort(out, 2); // block align
        writeShort(out, 16); // bits per sample
        writeAscii(out, "data");
        writeInt(out, pcm.length);
        out.write(pcm, 0, pcm.length);
        return out.toByteArray();
    }

    private static void writeAscii(ByteArrayOutputStream out, String s) {
        byte[] b = s.getBytes(StandardCharsets.US_ASCII);
        out.write(b, 0, b.length);
    }

    private static void writeInt(ByteArrayOutputStream out, int v) {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
        out.write((v >> 16) & 0xff);
        out.write((v >> 24) & 0xff);
    }

    private static void writeShort(ByteArrayOutputStream out, int v) {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
    }
}
