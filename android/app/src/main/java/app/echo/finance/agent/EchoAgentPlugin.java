package app.echo.finance.agent;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Lets the web app control the always-on agent: name it, turn it on and
 * off, teach it how its name sounds, and hear what it does.
 *
 * Events: "state" {state, detail}, "wake" {}, "heard" {text}, "turn" {reply}.
 */
@CapacitorPlugin(
    name = "EchoAgent",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = EchoAgentPlugin.MICROPHONE),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = EchoAgentPlugin.NOTIFICATIONS)
    }
)
public class EchoAgentPlugin extends Plugin implements AgentService.Listener {

    static final String MICROPHONE = "microphone";
    static final String NOTIFICATIONS = "notifications";

    private AgentPrefs prefs;

    @Override
    public void load() {
        prefs = new AgentPrefs(getContext());
        String server = getBridge().getServerUrl();
        prefs.setServerUrl(server != null ? server : getBridge().getLocalUrl());
        AgentService.listener = this;

        // Bring the agent back whenever the app opens; this is the only time
        // Android lets us (re)start a microphone service.
        if (prefs.enabled() && micGranted()) startService(AgentService.ACTION_START);
    }

    @Override
    protected void handleOnDestroy() {
        if (AgentService.listener == this) AgentService.listener = null;
    }

    // ------------------------------------------------------------------
    // Methods
    // ------------------------------------------------------------------

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String name = call.getString("name");
        if (name != null) prefs.setName(name);
        JSArray aliases = call.getArray("aliases");
        if (aliases != null) {
            List<String> list = new ArrayList<>();
            try {
                for (int i = 0; i < aliases.length(); i++) list.add(aliases.getString(i));
            } catch (JSONException e) {
                call.reject("aliases must be strings");
                return;
            }
            prefs.setAliases(list);
        }
        if (AgentService.isActive()) startService(AgentService.ACTION_RECONFIGURE);
        call.resolve(status());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!micGranted()) {
            requestPermissionForAliases(neededPermissions(), call, "afterPermissions");
            return;
        }
        prefs.setEnabled(true);
        startService(AgentService.ACTION_START);
        call.resolve(status());
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        if (!micGranted()) {
            call.reject("Microphone permission is needed for the agent to hear you.", "PERMISSION_DENIED");
            return;
        }
        prefs.setEnabled(true);
        startService(AgentService.ACTION_START);
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        prefs.setEnabled(false);
        getContext().stopService(new Intent(getContext(), AgentService.class));
        call.resolve(status());
    }

    /** Frees the mic while the in-app voice sheet records. */
    @PluginMethod
    public void pause(PluginCall call) {
        if (AgentService.isActive()) startService(AgentService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (AgentService.isActive()) startService(AgentService.ACTION_RESUME);
        call.resolve();
    }

    /** Listens for one phrase and reports what the recogniser heard as a "heard" event. */
    @PluginMethod
    public void calibrate(PluginCall call) {
        if (!AgentService.isActive()) {
            call.reject("Turn the agent on first.", "NOT_RUNNING");
            return;
        }
        startService(AgentService.ACTION_CALIBRATE);
        call.resolve();
    }

    /** Opens the system screen where the user can exempt Echo from battery optimisation. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ------------------------------------------------------------------
    // Service events → JS
    // ------------------------------------------------------------------

    @Override
    public void onAgentState(String state, String detail) {
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("detail", detail);
        notifyListeners("state", data);
    }

    @Override
    public void onAgentWake() {
        notifyListeners("wake", new JSObject());
    }

    @Override
    public void onAgentHeard(String text) {
        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("heard", data);
    }

    @Override
    public void onAgentTurn(JSONObject reply) {
        JSObject data = new JSObject();
        data.put("reply", reply);
        // Keep it until the web app is listening, e.g. after a reload.
        notifyListeners("turn", data, true);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private JSObject status() {
        JSObject out = new JSObject();
        out.put("enabled", prefs.enabled());
        out.put("running", AgentService.isActive());
        out.put("name", prefs.name());
        out.put("aliases", new JSArray(prefs.aliases()));
        out.put("state", AgentService.state());
        out.put("detail", AgentService.detail());
        out.put("modelReady", VoskModel.isReady(getContext()));
        out.put("microphone", permissionString(MICROPHONE));
        out.put("notifications", Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? permissionString(NOTIFICATIONS)
            : "granted");
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        out.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        return out;
    }

    private String permissionString(String alias) {
        PermissionState state = getPermissionState(alias);
        return state == null ? "prompt" : state.toString();
    }

    private boolean micGranted() {
        return getPermissionState(MICROPHONE) == PermissionState.GRANTED;
    }

    private String[] neededPermissions() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? new String[] { MICROPHONE, NOTIFICATIONS }
            : new String[] { MICROPHONE };
    }

    private void startService(String action) {
        Intent intent = new Intent(getContext(), AgentService.class).setAction(action);
        if (AgentService.ACTION_START.equals(action)) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().startService(intent);
        }
    }
}
