package net.langamehub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.res.AssetManager;
import android.net.wifi.WifiManager;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Process;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

public final class HubService extends Service {
    static final String STOP = "net.langamehub.STOP";
    static final String STATE = "hub-state.txt";
    static final String LOG = "hub-runtime.log";
    private Thread runtime;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private static native int launchNode(String file, String assets, String port, String secret, String log, boolean verbose);

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (runtime != null) return START_NOT_STICKY;

        startForeground(17, notification());
        int port = intent.getIntExtra("port", 8787);
        String secret = intent.getStringExtra("secret");
        state("starting");
        if (intent.getBooleanExtra("keepAwake", true)) acquireLocks();
        boolean verbose = intent.getBooleanExtra("verbose", true);
        runtime = new Thread(() -> runServer(port, secret, verbose), "LAN Game Hub");
        runtime.start();
        return START_NOT_STICKY;
    }

    private void runServer(int port, String secret, boolean verbose) {
        try {
            File root = new File(getFilesDir(), "runtime-" + BuildConfig.VERSION_CODE);
            File marker = new File(root, ".ready");
            long installedAt = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            String version = Long.toString(installedAt);
            String previous = marker.isFile() ? new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8) : "";
            if (!version.equals(previous)) {
                copyAssets(getAssets(), "hub", root);
                Files.write(marker.toPath(), version.getBytes(StandardCharsets.UTF_8));
            }
            System.loadLibrary("hub_node_bridge");
            state("running");
            int exit = launchNode(new File(root, "server.mjs").getPath(),
                    new File(root, "web").getPath(), Integer.toString(port), secret,
                    new File(getFilesDir(), LOG).getPath(), verbose);
            state("error\n服务进程已退出（" + exit + "）");
        } catch (Throwable error) {
            state("error\n" + error);
        }
        stopSelf();
    }

    private void copyAssets(AssetManager assets, String name, File destination) throws IOException {
        String[] entries = assets.list(name);
        if (entries != null && entries.length > 0) {
            if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException("无法创建资源目录");
            for (String child : entries) copyAssets(assets, name + "/" + child, new File(destination, child));
        } else {
            try (InputStream source = assets.open(name)) {
                Files.copy(source, destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        }
    }

    private void acquireLocks() {
        PowerManager power = getSystemService(PowerManager.class);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LANGameHub:server");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
        WifiManager wifi = getApplicationContext().getSystemService(WifiManager.class);
        if (wifi != null) {
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "LANGameHub:network");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
    }

    private Notification notification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("lan", "局域网服务",
                NotificationManager.IMPORTANCE_LOW));
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), flags);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, HubService.class).setAction(STOP), flags);
        return new Notification.Builder(this, "lan")
                .setContentTitle("LAN Game Hub")
                .setContentText("局域网游戏服务运行中")
                .setSmallIcon(R.drawable.hub_icon)
                .setOngoing(true).setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "停止服务", stop).build())
                .build();
    }

    private void state(String text) {
        File temporary = new File(getFilesDir(), STATE + ".tmp");
        try {
            Files.write(temporary.toPath(), text.getBytes(StandardCharsets.UTF_8));
            Files.move(temporary.toPath(), new File(getFilesDir(), STATE).toPath(),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ignored) {
            android.util.Log.w("LANGameHub", "无法保存服务状态");
        }
    }

    @Override public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
        // Node 的全局运行时每个进程只初始化一次。仅退出隔离的 :hub 进程。
        Process.killProcess(Process.myPid());
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
