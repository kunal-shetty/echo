package app.echo.finance.agent;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

/** The agent's settings, kept natively so the service can run without the WebView. */
public final class AgentPrefs {

    public static final String DEFAULT_NAME = "Echo";
    public static final int MAX_ALIASES = 6;

    private static final String FILE = "echo_agent";
    private static final String KEY_NAME = "name";
    private static final String KEY_ALIASES = "aliases";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_SERVER_URL = "serverUrl";

    private final SharedPreferences prefs;

    public AgentPrefs(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String name() {
        String name = prefs.getString(KEY_NAME, DEFAULT_NAME);
        return name == null || name.trim().isEmpty() ? DEFAULT_NAME : name;
    }

    public List<String> aliases() {
        List<String> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs.getString(KEY_ALIASES, "[]"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (JSONException ignored) {
            // Corrupt value: behave as if there are no aliases.
        }
        return out;
    }

    public boolean enabled() {
        return prefs.getBoolean(KEY_ENABLED, false);
    }

    /** Base URL of the Echo server, e.g. http://10.0.2.2:3000 (no trailing slash). */
    public String serverUrl() {
        return prefs.getString(KEY_SERVER_URL, null);
    }

    public void setName(String name) {
        String trimmed = name == null ? "" : name.trim().replaceAll("\\s+", " ");
        if (trimmed.length() > 24) trimmed = trimmed.substring(0, 24);
        prefs.edit().putString(KEY_NAME, trimmed.isEmpty() ? DEFAULT_NAME : trimmed).apply();
    }

    public void setAliases(List<String> aliases) {
        JSONArray arr = new JSONArray();
        for (String alias : aliases) {
            if (alias == null) continue;
            String a = alias.trim().toLowerCase();
            if (!a.isEmpty() && arr.length() < MAX_ALIASES) arr.put(a);
        }
        prefs.edit().putString(KEY_ALIASES, arr.toString()).apply();
    }

    public void setEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    public void setServerUrl(String url) {
        if (url == null) return;
        prefs.edit().putString(KEY_SERVER_URL, url.replaceAll("/+$", "")).apply();
    }
}
