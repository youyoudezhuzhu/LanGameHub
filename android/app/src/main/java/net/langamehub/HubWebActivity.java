package net.langamehub;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 内置大厅：用 WebView 直接把本机 node 服务器跑出来的网页装进 App 里。
 *
 * 以前点「进入大厅」是 startActivity(ACTION_VIEW)，会跳到外部浏览器：
 *  - 一跳出去 App 就退到后台，服务容易被系统回收；
 *  - 外部浏览器的地址栏、手势区让全屏和横屏都不好控制。
 * 现在改成内置 WebView，页面一直在 App 前台，服务进程也就一直活着，
 * 不再需要额外的 WakeLock / WiFiLock 去保活。
 *
 * 支持：
 *  - 网页里的 Fullscreen API（全屏按钮 / 蛇场锁横屏）走 onShowCustomView，真沉浸式；
 *  - 旋转屏幕不重建 Activity（manifest 里声明了 configChanges），页面靠 CSS 自适应；
 *  - 返回键：先退全屏 → 再退网页历史 → 最后回到原生设置界面；
 *  - 顶部中间一个很小的「设置」按钮，随时切回原生界面看二维码 / 端口 / 诊断。
 */
public final class HubWebActivity extends Activity {
    /** 原生设置界面的入口，返回时用它 */
    static final String EXTRA_FROM_WEB = "fromWeb";

    private WebView webView;
    private FrameLayout root;
    private FrameLayout fullscreenContainer;
    private FrameLayout errorPanel;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private Button settingsButton;
    private int background = 0xff10141e;

    private int port() {
        return getSharedPreferences("hub", MODE_PRIVATE).getInt("port", 8787);
    }

    private String entryUrl() {
        Uri.Builder entry = Uri.parse("http://127.0.0.1:" + port() + "/").buildUpon();
        String nickname = getSharedPreferences("hub", MODE_PRIVATE).getString("nickname", "");
        if (nickname != null && !nickname.isEmpty()) entry.appendQueryParameter("hostName", nickname);
        return entry.build().toString();
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        background = getSharedPreferences("hub", MODE_PRIVATE).getBoolean("light", false)
                ? 0xffeff2f8 : 0xff10141e;

        root = new FrameLayout(this);
        root.setBackgroundColor(background);
        setContentView(root);

        fullscreenContainer = new FrameLayout(this);
        root.addView(fullscreenContainer, new FrameLayout.LayoutParams(-1, -1));

        webView = new WebView(this);
        fullscreenContainer.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        applySettings(webView.getSettings());

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return blockExternal(request.getUrl());
            }

            @Override @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return blockExternal(Uri.parse(url));
            }

            @Override public void onPageFinished(WebView view, String url) {
                hideError();
                view.evaluateJavascript(ROUTE_SCRIPT, null);
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 只处理主文档的错误；子资源失败不影响页面本身
                if (request.isForMainFrame()) showError();
            }

            @Override @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String description, String failingUrl) {
                showError();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                fullscreenContainer.addView(customView, new FrameLayout.LayoutParams(-1, -1));
                webView.setVisibility(View.GONE);
                // 真全屏时藏掉原生按钮，避免压住游戏画面
                if (settingsButton != null) settingsButton.setVisibility(View.GONE);
                applyImmersive(true);
            }

            @Override public void onHideCustomView() {
                exitFullscreenView();
            }
        });

        addShellBridge();
        addErrorPanel();

        webView.loadUrl(entryUrl());
    }

    private void applySettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // 页面自带 viewport meta，CSS 像素即设备独立像素，横竖屏换布局才对
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 只加载本机局域网服务生成的内容，不需要访问本地文件
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
    }

    /** 只放行本机地址；外部链接不接管，直接忽略并提示 */
    private boolean blockExternal(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme != null && scheme.startsWith("http")) {
            String host = uri.getHost();
            boolean local = "127.0.0.1".equals(host) || "localhost".equals(host);
            if (!local) {
                toast("内置窗口只打开本机服务，外部链接请用浏览器打开");
                return true;
            }
        }
        return false;
    }

    /**
     * 原生「主机设置」入口。
     *
     * 不常驻显示：只有页面停在大厅（#/ 或 #/gallery）时才浮在右下角，
     * 一旦进入对局就自动隐藏，避免压住牌桌顶栏和手牌。
     * 页面路由通过下面这个 JS 桥实时同步过来。
     */
    private void addShellBridge() {
        settingsButton = new Button(this);
        settingsButton.setText("主机");
        settingsButton.setAllCaps(false);
        settingsButton.setTextSize(11);
        settingsButton.setTextColor(0xffeaf0ff);
        settingsButton.setPadding(dp(9), 0, dp(9), 0);
        settingsButton.setMinWidth(0);
        settingsButton.setMinimumWidth(0);
        settingsButton.setMinimumHeight(0);
        settingsButton.setStateListAnimator(null);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(0xcc1b2333);
        pill.setCornerRadius(dp(99));
        settingsButton.setBackground(new android.graphics.drawable.RippleDrawable(
                ColorStateList.valueOf(0x33ffffff), pill, null));
        settingsButton.setOnClickListener(v -> returnToSettings());
        settingsButton.setVisibility(View.GONE);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(46), dp(26));
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.rightMargin = dp(10);
        params.bottomMargin = dp(10);
        root.addView(settingsButton, params);

        webView.addJavascriptInterface(new ShellBridge(), "HubShell");
    }

    /** 页面通过它告诉原生层当前在哪个界面，决定「主机」按钮要不要显示 */
    private final class ShellBridge {
        @android.webkit.JavascriptInterface
        public void setRoute(final String route) {
            runOnUiThread(() -> {
                if (settingsButton == null) return;
                boolean home = "#/".equals(route) || "#".equals(route) || route.isEmpty()
                        || route.startsWith("#/gallery");
                // 全屏状态下永远不显示，免得打断游戏
                settingsButton.setVisibility(home && customView == null ? View.VISIBLE : View.GONE);
            });
        }
    }

    /** 注入一小段脚本：路由变化时通知原生层 */
    private static final String ROUTE_SCRIPT =
            "(function(){var r='HubShell';if(!window[r])return;" +
            "function push(){try{window[r].setRoute(location.hash||'#/');}catch(e){}}" +
            "push();window.addEventListener('hashchange',push);" +
            "window.__hubRoutePushed=true;})();";

    private void addErrorPanel() {
        errorPanel = new FrameLayout(this);
        errorPanel.setBackgroundColor(background);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = new TextView(this);
        title.setText("连不上本机服务");
        title.setTextSize(19);
        title.setTextColor(0xfff0f3ff);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText("服务可能还没启动完成。点下面重试，或回到设置里看一下服务状态。");
        hint.setTextSize(14);
        hint.setTextColor(0xffb4bed4);
        hint.setPadding(0, dp(8), 0, dp(16));
        hint.setGravity(Gravity.CENTER);
        box.addView(hint);

        Button retry = new Button(this);
        retry.setText("重试");
        retry.setAllCaps(false);
        retry.setTextColor(0xff1b2852);
        GradientDrawable fill = new GradientDrawable();
        fill.setColor(0xffb6c4ff);
        fill.setCornerRadius(dp(12));
        retry.setBackground(fill);
        retry.setOnClickListener(v -> {
            hideError();
            webView.loadUrl(entryUrl());
        });
        box.addView(retry, new LinearLayout.LayoutParams(dp(150), dp(46)));

        Button back = new Button(this);
        back.setText("回到设置");
        back.setAllCaps(false);
        back.setTextColor(0xfff0f3ff);
        GradientDrawable outline = new GradientDrawable();
        outline.setColor(0xff191f2e);
        outline.setCornerRadius(dp(12));
        back.setBackground(outline);
        back.setOnClickListener(v -> returnToSettings());
        LinearLayout.LayoutParams backParams = new LinearLayout.LayoutParams(dp(150), dp(46));
        backParams.topMargin = dp(10);
        box.addView(back, backParams);

        FrameLayout.LayoutParams boxParams = new FrameLayout.LayoutParams(-2, -2);
        boxParams.gravity = Gravity.CENTER;
        errorPanel.addView(box, boxParams);
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showError() {
        if (errorPanel != null) errorPanel.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        if (errorPanel != null) errorPanel.setVisibility(View.GONE);
    }

    private void applyImmersive(boolean immersive) {
        View decor = getWindow().getDecorView();
        if (immersive) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            getWindow().setStatusBarColor(Color.BLACK);
            getWindow().setNavigationBarColor(Color.BLACK);
        } else {
            decor.setSystemUiVisibility(0);
            getWindow().setStatusBarColor(background);
            getWindow().setNavigationBarColor(background);
            if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
        }
    }

    /** 退出网页全屏（网页点退出全屏、按返回键、或系统回调都会走到这里） */
    private void exitFullscreenView() {
        if (customView == null) {
            applyImmersive(false);
            return;
        }
        fullscreenContainer.removeView(customView);
        customView = null;
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
        webView.setVisibility(View.VISIBLE);
        applyImmersive(false);
        // 全屏退出后按当前路由决定「主机」按钮要不要出来
        webView.evaluateJavascript(ROUTE_SCRIPT, null);
    }

    /**
     * 切回原生设置界面。
     *
     * 关键：**不 finish() 自己**，而是把 MainActivity 重新排序到前台。
     * 这样栈变成 [大厅, 设置]，WebView 一直活着，对局状态（JS 里的牌局、
     * 房间连接）都还在；从设置界面按返回键就直接回到刚才那局。
     */
    private void returnToSettings() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_FROM_WEB, true);
        intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    @Override public void onBackPressed() {
        if (customView != null) {
            // 全屏时先让网页自己也退出，再收掉原生全屏层
            webView.evaluateJavascript(
                    "(function(){var d=document;if(d.exitFullscreen)d.exitFullscreen();" +
                    "else if(d.webkitExitFullscreen)d.webkitExitFullscreen();})()", null);
            exitFullscreenView();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // 已经不在一局里了：退回原生设置界面，而不是直接退出 App
        returnToSettings();
    }

    @SuppressLint("MissingSuperCall")
    @Override protected void onSaveInstanceState(Bundle state) {
        // WebView 会自己恢复；不调 super 以免丢 View 层级
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (customView != null) applyImmersive(true);
    }

    /** 服务比页面先启动的场景：回到前台时如果页面是错误页，自动重试一次 */
    @Override protected void onRestart() {
        super.onRestart();
        if (errorPanel != null && errorPanel.getVisibility() == View.VISIBLE) {
            hideError();
            webView.loadUrl(entryUrl());
        }
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}
