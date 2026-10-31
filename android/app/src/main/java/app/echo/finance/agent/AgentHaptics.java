package app.echo.finance.agent;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/** Vibration patterns the agent uses so you can tell what happened without looking. */
final class AgentHaptics {

    /** Two quick taps: "I heard my name, go ahead". */
    static final long[] WAKE = { 0, 30, 70, 30 };
    /** A tap then a firmer pulse: "done". */
    static final long[] SUCCESS = { 0, 40, 90, 90 };
    /** Two medium pulses: "check this". */
    static final long[] WARNING = { 0, 120, 110, 120 };
    /** Two long pulses: "something went wrong". */
    static final long[] ERROR = { 0, 280, 120, 280 };

    private AgentHaptics() {}

    static long[] forKind(String kind) {
        if ("success".equals(kind)) return SUCCESS;
        if ("warning".equals(kind)) return WARNING;
        if ("error".equals(kind)) return ERROR;
        return WAKE;
    }

    static void play(Context context, long[] pattern) {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm == null ? null : vm.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } else {
            vibrator.vibrate(pattern, -1);
        }
    }
}
