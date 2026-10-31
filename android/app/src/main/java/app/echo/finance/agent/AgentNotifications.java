package app.echo.finance.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import app.echo.finance.MainActivity;
import app.echo.finance.R;

/** The agent's two notification channels: the ongoing "listening" one and results. */
final class AgentNotifications {

    static final String CHANNEL_ONGOING = "echo_agent";
    static final String CHANNEL_RESULTS = "echo_agent_results";
    static final int ONGOING_ID = 7001;
    private static final int RESULT_ID = 7002;

    private AgentNotifications() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        NotificationChannel ongoing = new NotificationChannel(
            CHANNEL_ONGOING, "Voice agent", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("Shown while your agent is listening for its name.");
        ongoing.setShowBadge(false);
        NotificationChannel results = new NotificationChannel(
            CHANNEL_RESULTS, "Agent replies", NotificationManager.IMPORTANCE_DEFAULT);
        results.setDescription("What your agent saved, changed or answered.");
        // The agent vibrates with its own patterns, so the channel doesn't.
        results.enableVibration(false);
        nm.createNotificationChannel(ongoing);
        nm.createNotificationChannel(results);
    }

    private static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Notification ongoing(Context context, String name, String status) {
        Intent stop = new Intent(context, AgentService.class).setAction(AgentService.ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(context, 1, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_echo)
            .setContentTitle(name)
            .setContentText(status)
            .setContentIntent(openApp(context))
            .addAction(0, "Stop", stopPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    static void update(Context context, String name, String status) {
        post(context, ONGOING_ID, ongoing(context, name, status));
    }

    static void result(Context context, String title, String body) {
        Notification n = new NotificationCompat.Builder(context, CHANNEL_RESULTS)
            .setSmallIcon(R.drawable.ic_stat_echo)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setSilent(true)
            .build();
        post(context, RESULT_ID, n);
    }

    private static void post(Context context, int id, Notification n) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        if (!nm.areNotificationsEnabled()) return;
        try {
            nm.notify(id, n);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS was revoked; the agent still speaks and vibrates.
        }
    }
}
