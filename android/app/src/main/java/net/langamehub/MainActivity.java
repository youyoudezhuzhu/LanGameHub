package net.langamehub;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int DARK = 0xff10141e;
    private static final int ACCENT = 0xffb6c4ff;
    private static final int CHOOSE_LOG = 301;
    private static final String[] TABS = {"服务", "游戏", "房间", "设置", "诊断"};
    private static final String[] GAMES = {
        "斗地主", "掼蛋", "德州扑克", "四川麻将", "中国象棋", "国际象棋",
        "魔法出包", "UON", "卡旦岛", "宝石商会", "流光蛇场"
    };

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private int selected;
    private boolean pvzInstalled;
    private boolean visible;
    private boolean loading;
    private long startingUntil;
    private long stoppingUntil;
    private JSONObject status;
    private boolean processAlive;
    private boolean wsHealthy;
    private List<String> addresses = new ArrayList<>();
    private String address = "";
    private String lastState = "";
    private String log = "";
    private LinearLayout page;
    private TextView statusLabel, countsLabel, addressLabel;
    private Button serviceButton, restartButton, copyButton, lobbyButton;
    private ImageView qr;
    private String qrLink = "";
    private String renderedRooms = "";
    private String renderedDiagnosis = "";
    private int background, surface, ink, muted, primary, primaryInk;

    private final Runnable polling = new Runnable() {
        @Override public void run() {
            refresh();
            if (visible) handler.postDelayed(this, 1600);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("hub", MODE_PRIVATE);
        try (java.io.InputStream module = getAssets().open("hub/web/games/pvz/hub-module.json")) {
            pvzInstalled = module.read() != -1;
        } catch (java.io.IOException ignored) {}
        if (!preferences.contains("secret")) {
            byte[] random = new byte[32];
            new java.security.SecureRandom().nextBytes(random);
            preferences.edit().putString("secret", android.util.Base64.encodeToString(random,
                    android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE)).apply();
        }
        if (state != null) selected = state.getInt("tab");
        render();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putInt("tab", selected);
        super.onSaveInstanceState(state);
    }

    @Override protected void onStart() {
        super.onStart();
        visible = true;
        handler.post(polling);
    }

    @Override protected void onStop() {
        visible = false;
        handler.removeCallbacks(polling);
        super.onStop();
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private int port() { return preferences.getInt("port", 8787); }
    private String secret() { return preferences.getString("secret", ""); }
    private boolean online() { return status != null; }
    private int installedGameCount() { return GAMES.length + (pvzInstalled ? 1 : 0); }

    private void refresh() {
        if (loading || executor.isShutdown()) return;
        loading = true;
        int port = port();
        String secret = secret();
        boolean diagnose = selected == 4;
        executor.execute(() -> {
            HostClient client = new HostClient(port, secret);
            JSONObject next = null;
            try { next = client.status(); } catch (Exception ignored) {}
            boolean process = hubProcessPresent();
            boolean websocket = diagnose && next != null && client.websocketHealthy();
            List<String> ips = lanAddresses();
            String state = HostClient.tail(this, HubService.STATE, 2000);
            String recent = diagnose ? HostClient.tail(this, HubService.LOG, 6000) : "";
            JSONObject response = next;
            handler.post(() -> {
                loading = false;
                if (isDestroyed() || port != port()) return;
                status = response;
                processAlive = process;
                wsHealthy = websocket;
                addresses = ips;
                if (!addresses.contains(address)) address = addresses.isEmpty() ? "" : addresses.get(0);
                lastState = state;
                if (diagnose) log = recent;
                if (online()) startingUntil = 0;
                if (!processAlive && !online() && stoppingUntil != 0) stoppingUntil = 0;
                if (selected == 0) updateHome();
                if (selected == 2 && !roomData().equals(renderedRooms)) render();
                if (selected == 4 && !diagnosticData().equals(renderedDiagnosis)) render();
            });
        });
    }

    private boolean hubProcessPresent() {
        ActivityManager manager = getSystemService(ActivityManager.class);
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (process.processName.equals(getPackageName() + ":hub")) return true;
        }
        return false;
    }

    private List<String> lanAddresses() {
        List<String> result = new ArrayList<>();
        List<NetworkInterface> candidates = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) candidates.add(interfaces.nextElement());
            candidates.sort(Comparator.comparingInt((NetworkInterface nic) -> {
                String name = nic.getName();
                if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) return 0;
                if (name.startsWith("eth") || name.startsWith("rndis") || name.startsWith("bridge")) return 1;
                return 2;
            }));
            for (NetworkInterface network : candidates) {
                String name = network.getName();
                if (!network.isUp() || network.isLoopback() || name.startsWith("rmnet")
                        || name.startsWith("ccmni") || name.startsWith("tun") || name.startsWith("p2p"))
                    continue;
                Enumeration<InetAddress> ips = network.getInetAddresses();
                while (ips.hasMoreElements()) {
                    InetAddress ip = ips.nextElement();
                    if (ip instanceof Inet4Address && !ip.isLoopbackAddress() &&
                            ip.isSiteLocalAddress() && !result.contains(ip.getHostAddress())) {
                        result.add(ip.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) {}
        return result;
    }

    private String link() {
        if (!online() || address.isEmpty()) return "";
        return "http://" + address + ":" + port() + "/";
    }

    private void start() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED && !preferences.getBoolean("askedNotification", false)) {
            preferences.edit().putBoolean("askedNotification", true).apply();
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 12);
        }
        startingUntil = SystemClock.elapsedRealtime() + 15000;
        stoppingUntil = 0;
        try {
            startForegroundService(new Intent(this, HubService.class).putExtra("port", port())
                    .putExtra("secret", secret()).putExtra("keepAwake", preferences.getBoolean("awake", true))
                    .putExtra("verbose", preferences.getBoolean("verbose", true)));
        } catch (RuntimeException error) {
            startingUntil = 0;
            toast("无法启动服务：" + error.getMessage());
        }
        if (selected == 0) updateHome();
    }

    private void stop(boolean restart) {
        startingUntil = 0;
        stoppingUntil = SystemClock.elapsedRealtime() + 5000;
        stopService(new Intent(this, HubService.class));
        if (selected == 0) updateHome();
        if (restart) waitForRestart(SystemClock.elapsedRealtime() + 6000);
    }

    private void waitForRestart(long deadline) {
        handler.postDelayed(() -> {
            if (isDestroyed()) return;
            if (!hubProcessPresent()) start();
            else if (SystemClock.elapsedRealtime() < deadline) waitForRestart(deadline);
            else toast("服务正在关闭，请稍后再启动");
        }, 250);
    }

    private void render() {
        boolean light = preferences.getBoolean("light", false);
        background = light ? 0xffeff2f8 : DARK;
        surface = light ? 0xfffbfcff : 0xff191f2e;
        ink = light ? 0xff172138 : 0xfff0f3ff;
        muted = light ? 0xff586781 : 0xffb4bed4;
        primary = light ? 0xff4054a7 : ACCENT;
        primaryInk = light ? Color.WHITE : 0xff1b2852;
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        getWindow().getDecorView().setSystemUiVisibility(light
                ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setBackgroundColor(background);
        if (Build.VERSION.SDK_INT >= 35) container.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        setContentView(container);

        LinearLayout appBar = row();
        appBar.setPadding(dp(18), dp(12), dp(18), dp(10));
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.hub_icon);
        appBar.addView(mark, new LinearLayout.LayoutParams(dp(39), dp(39)));
        TextView name = label("LAN Game Hub", 22, ink);
        name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams title = new LinearLayout.LayoutParams(-2, -2);
        title.leftMargin = dp(10);
        appBar.addView(name, title);
        container.addView(appBar);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(18), dp(6), dp(18), dp(22));
        scroll.addView(page);
        container.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout tabs = row();
        tabs.setPadding(dp(8), dp(5), dp(8), dp(5));
        for (int i = 0; i < TABS.length; i++) {
            int tab = i;
            Button item = button(TABS[i], selected == i, () -> {
                selected = tab;
                render();
                refresh();
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
            params.setMargins(dp(2), 0, dp(2), 0);
            tabs.addView(item, params);
        }
        container.addView(tabs);
        if (selected == 0) home();
        else if (selected == 1) games();
        else if (selected == 2) rooms();
        else if (selected == 3) settings();
        else diagnostics();
    }

    private void home() {
        LinearLayout server = card("局域网服务");
        statusLabel = label("", 22, ink);
        statusLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        server.addView(statusLabel);
        countsLabel = label("", 14, muted);
        server.addView(countsLabel);
        LinearLayout controls = row();
        serviceButton = button("启动服务", true, () -> { if (online() || processAlive) stop(false); else start(); });
        controls.addView(serviceButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        restartButton = button("重启", false, () -> stop(true));
        LinearLayout.LayoutParams restartParams = new LinearLayout.LayoutParams(-2, dp(48));
        restartParams.leftMargin = dp(8);
        controls.addView(restartButton, restartParams);
        space(server, 12);
        server.addView(controls);

        LinearLayout join = card("邀请玩家");
        addressLabel = label("", 16, ink);
        addressLabel.setTextIsSelectable(true);
        join.addView(addressLabel);
        qr = new ImageView(this);
        qr.setContentDescription("浏览器加入二维码");
        LinearLayout.LayoutParams qrParams = new LinearLayout.LayoutParams(dp(194), dp(194));
        qrParams.gravity = Gravity.CENTER_HORIZONTAL;
        qrParams.topMargin = dp(14);
        qrParams.bottomMargin = dp(10);
        join.addView(qr, qrParams);
        qrLink = "";
        LinearLayout links = row();
        copyButton = button("复制链接", false, () -> {
            ClipboardManager clipboard = getSystemService(ClipboardManager.class);
            clipboard.setPrimaryClip(ClipData.newPlainText("LAN Game Hub", link()));
            toast("已复制加入链接");
        });
        links.addView(copyButton, new LinearLayout.LayoutParams(0, dp(48), 1));
        lobbyButton = button("进入大厅", true, this::openLobby);
        LinearLayout.LayoutParams lobbyParams = new LinearLayout.LayoutParams(0, dp(48), 1);
        lobbyParams.leftMargin = dp(8);
        links.addView(lobbyButton, lobbyParams);
        space(join, 8);
        join.addView(links);
        join.addView(button("选择网络地址", false, this::chooseAddress));
        updateHome();
    }

    private void updateHome() {
        if (statusLabel == null) return;
        long now = SystemClock.elapsedRealtime();
        boolean pendingStart = !online() && now < startingUntil;
        boolean pendingStop = now < stoppingUntil;
        String state = pendingStop ? "正在停止…" : online() ? "服务运行中" : pendingStart
                ? "正在启动…" : lastState.startsWith("error") ? "启动失败 · 查看诊断"
                : processAlive ? "服务未响应 · 查看诊断" : "服务已停止";
        statusLabel.setText(state);
        countsLabel.setText(online() ? status.optInt("clients") + " 位在线玩家  ·  "
                + status.optInt("rooms") + " 个房间  ·  " + installedGameCount() + " 款游戏" : installedGameCount() + " 款已安装游戏");
        serviceButton.setText(online() || processAlive ? "停止服务" : "启动服务");
        enabled(serviceButton, !pendingStart && !pendingStop);
        enabled(restartButton, online() && !pendingStop);
        String url = link();
        addressLabel.setText(!url.isEmpty() ? url : online() ? "连接 Wi-Fi 或开启热点以邀请玩家。"
                : "启动服务后，同一 Wi-Fi 或热点内的设备可扫码加入。");
        enabled(copyButton, !url.isEmpty());
        enabled(lobbyButton, online());
        if (!url.equals(qrLink)) {
            qrLink = url;
            qr.setImageBitmap(url.isEmpty() ? null : qrBitmap(url));
        }
        qr.setVisibility(url.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private Bitmap qrBitmap(String url) {
        try {
            BitMatrix matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 256, 256);
            int[] pixels = new int[256 * 256];
            for (int y = 0; y < 256; y++) for (int x = 0; x < 256; x++)
                pixels[y * 256 + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
            return Bitmap.createBitmap(pixels, 256, 256, Bitmap.Config.ARGB_8888);
        } catch (Exception error) {
            return null;
        }
    }

    private void chooseAddress() {
        if (addresses.isEmpty()) {
            toast("未找到 Wi-Fi、热点或有线局域网地址");
            return;
        }
        String[] options = addresses.toArray(new String[0]);
        new AlertDialog.Builder(this).setTitle("局域网地址")
                .setSingleChoiceItems(options, addresses.indexOf(address), (dialog, which) -> {
                    address = options[which];
                    dialog.dismiss();
                    updateHome();
                }).setNegativeButton("取消", null).show();
    }

    private void openLobby() {
        String url = link();
        if (url.isEmpty()) url = "http://127.0.0.1:" + port() + "/";
        Uri.Builder entry = Uri.parse(url).buildUpon();
        String nickname = preferences.getString("nickname", "");
        if (!nickname.isEmpty()) entry.appendQueryParameter("hostName", nickname);
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, entry.build()));
        } catch (RuntimeException error) {
            toast("请安装支持 JavaScript 的浏览器");
        }
    }

    private void games() {
        LinearLayout games = card("已安装游戏");
        for (String game : GAMES) {
            TextView line = label("◈   " + game + "  ·  单人 / 局域网联机", 16, ink);
            line.setPadding(0, dp(9), 0, dp(9));
            games.addView(line);
        }
        if (pvzInstalled) games.addView(label("◈   pvz_perf  ·  离线单人", 16, ink));
        LinearLayout pending = card("待接入");
        pending.addView(label(pvzInstalled ? "Slithering.io、Saltline" : "Slithering.io、Saltline、pvz_perf", 15, muted));
    }

    private String roomData() { return online() ? status.optString("roomList") : ""; }

    private void rooms() {
        renderedRooms = roomData();
        LinearLayout panel = card("房间与玩家");
        JSONArray rooms = online() ? status.optJSONArray("roomList") : null;
        if (rooms == null || rooms.length() == 0)
            panel.addView(label(online() ? "当前没有房间" : "启动服务后查看房间。", 15, muted));
        if (rooms == null) return;
        for (int i = 0; i < rooms.length(); i++) {
            JSONObject room = rooms.optJSONObject(i);
            if (room == null) continue;
            String code = room.optString("code");
            String state = room.optString("status");
            String translated = state.equals("waiting") ? "等待开局" : state.equals("playing") ? "对局中" : "已结束";
            panel.addView(label(room.optString("game") + "  ·  " + code + "\n"
                    + room.optInt("players") + " / " + room.optInt("capacity") + " 玩家  ·  " + translated, 16, ink));
            panel.addView(button("解散房间 " + code, false, () -> new AlertDialog.Builder(this)
                    .setTitle("解散房间 " + code + "？")
                    .setMessage("房间内的玩家会退出当前对局。")
                    .setNegativeButton("取消", null).setPositiveButton("解散", (dialog, which) -> {
                        HostClient client = new HostClient(port(), secret());
                        executor.execute(() -> {
                            boolean success = false;
                            try { success = client.closeRoom(code); } catch (Exception ignored) {}
                            boolean closed = success;
                            handler.post(() -> { toast(closed ? "房间已解散" : "房间已关闭或服务无法访问"); refresh(); });
                        });
                    }).show()));
            space(panel, 10);
        }
    }

    private void settings() {
        LinearLayout panel = card("主机设置");
        panel.addView(label("服务端口", 15, muted));
        EditText field = new EditText(this);
        field.setTextColor(ink);
        field.setSingleLine();
        field.setInputType(InputType.TYPE_CLASS_NUMBER);
        field.setText(Integer.toString(port()));
        field.setContentDescription("服务端口");
        panel.addView(field);
        panel.addView(button("保存端口", true, () -> {
            if (online() || processAlive || SystemClock.elapsedRealtime() < startingUntil) {
                toast("请先停止服务，再修改端口");
                return;
            }
            try {
                int newPort = Integer.parseInt(field.getText().toString());
                if (newPort < 1024 || newPort > 65535) throw new NumberFormatException();
                preferences.edit().putInt("port", newPort).apply();
                toast("端口已保存");
            } catch (NumberFormatException error) {
                field.setError("请输入 1024 到 65535 的端口");
            }
        }));
        space(panel, 13);
        Switch awake = new Switch(this);
        awake.setText("锁屏时维持运行");
        awake.setTextColor(ink);
        awake.setChecked(preferences.getBoolean("awake", true));
        awake.setOnCheckedChangeListener((button, checked) -> {
            preferences.edit().putBoolean("awake", checked).apply();
            if (online() || processAlive) toast("重启服务后生效");
        });
        panel.addView(awake, new LinearLayout.LayoutParams(-1, dp(48)));
        panel.addView(label("运行期间持有 CPU / Wi-Fi 锁。系统省电策略和热点休眠仍可能断开连接。", 14, muted));
        panel.addView(button("系统电池设置", false, () -> {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (RuntimeException error) { toast("当前设备没有提供此设置入口"); }
        }));
        Switch theme = new Switch(this);
        theme.setText("浅色主机界面");
        theme.setTextColor(ink);
        theme.setChecked(preferences.getBoolean("light", false));
        theme.setOnCheckedChangeListener((button, checked) -> {
            preferences.edit().putBoolean("light", checked).apply();
            render();
        });
        panel.addView(theme, new LinearLayout.LayoutParams(-1, dp(48)));
        space(panel, 12);
        panel.addView(label("主机默认昵称", 15, muted));
        EditText nickname = new EditText(this);
        nickname.setTextColor(ink);
        nickname.setSingleLine();
        nickname.setFilters(new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(24)});
        nickname.setText(preferences.getString("nickname", ""));
        nickname.setHint("留空时使用浏览器昵称");
        nickname.setHintTextColor(muted);
        panel.addView(nickname);
        panel.addView(button("保存昵称", false, () -> {
            preferences.edit().putString("nickname", nickname.getText().toString().trim()).apply();
            toast("下次从主机进入大厅时生效");
        }));
        Switch verbose = new Switch(this);
        verbose.setText("记录房间事件");
        verbose.setTextColor(ink);
        verbose.setChecked(preferences.getBoolean("verbose", true));
        verbose.setOnCheckedChangeListener((button, checked) -> {
            preferences.edit().putBoolean("verbose", checked).apply();
            if (online() || processAlive) toast("重启服务后生效");
        });
        panel.addView(verbose, new LinearLayout.LayoutParams(-1, dp(48)));
        panel.addView(label("语言 · 简体中文", 14, muted));
    }

    private String diagnosticData() {
        return (online() ? status.optInt("sockets") + ":" + status.optLong("rss") / 1048576 : "offline")
                + processAlive + wsHealthy + addresses + lastState + log;
    }

    private void diagnostics() {
        renderedDiagnosis = diagnosticData();
        LinearLayout panel = card("服务诊断");
        File apk = new File(getApplicationInfo().sourceDir);
        panel.addView(label("进程 · " + (processAlive ? "已启动" : "已停止")
                + "\nHTTP · " + (online() ? "正常" : "未响应")
                + "\nWebSocket · " + (wsHealthy ? "握手通过" : "未通过")
                + "\nIPv4 · " + (addresses.isEmpty() ? "未识别" : String.join("、", addresses))
                + "\n连接 · " + (online() ? status.optInt("sockets") : "—")
                + "\n服务内存 · " + (online() ? (status.optLong("rss") / 1048576) + " MiB RSS" : "—")
                + "\nAPK · " + (apk.length() / 1048576) + " MiB", 15, ink));
        if (lastState.startsWith("error")) panel.addView(label(lastState.substring(5).trim(), 14, muted));
        LinearLayout logs = card("最近日志");
        TextView text = label(log.isEmpty() ? "暂无运行日志" : log, 13, muted);
        text.setTextIsSelectable(true);
        logs.addView(text);
        logs.addView(button("导出日志", false, () -> {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/plain")
                    .putExtra(Intent.EXTRA_TITLE, "lan-game-hub.log");
            try { startActivityForResult(intent, CHOOSE_LOG); }
            catch (RuntimeException error) { toast("设备没有可用的文档提供程序"); }
        }));
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != CHOOSE_LOG || result != RESULT_OK || data == null || data.getData() == null) return;
        try (OutputStream target = getContentResolver().openOutputStream(data.getData())) {
            if (target == null) throw new java.io.IOException("无法打开日志文件");
            target.write((HostClient.tail(this, HubService.STATE, 2000) + "\n"
                    + HostClient.tail(this, HubService.LOG, 1024 * 1024)).getBytes(StandardCharsets.UTF_8));
            toast("日志已导出");
        } catch (Exception error) {
            toast("日志导出失败");
        }
    }

    private LinearLayout card(String title) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(15), dp(16), dp(16));
        card.setBackground(round(surface, 20));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(12);
        page.addView(card, params);
        TextView heading = label(title, 17, ink);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        card.addView(heading);
        space(card, 8);
        return card;
    }

    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(3), 1f);
        return view;
    }

    private void enabled(Button button, boolean enabled) {
        button.setEnabled(enabled);
        button.setAlpha(enabled ? 1f : .46f);
    }

    private Button button(String text, boolean emphasis, Runnable action) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(14);
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setMinimumHeight(dp(44));
        button.setTextColor(emphasis ? primaryInk : ink);
        button.setBackground(new android.graphics.drawable.RippleDrawable(ColorStateList.valueOf(0x337c8cbd),
                round(emphasis ? primary : surface, 12), null));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        return shape;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private void space(LinearLayout parent, int height) {
        parent.addView(new View(this), new LinearLayout.LayoutParams(1, dp(height)));
    }

    private int dp(int value) { return Math.round(getResources().getDisplayMetrics().density * value); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_SHORT).show(); }
}
