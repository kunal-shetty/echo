package app.echo.finance;

import android.os.Bundle;
import app.echo.finance.agent.EchoAgentPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(EchoAgentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
