package kr.eumsoft.eumchat;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** 이음챗: 웹 화면을 앱 안의 웹뷰로 보여주고, Google Play 결제는 BillingBridge 로 처리한다. */
public class MainActivity extends Activity {
    static final String HOST = "eumchat-production.up.railway.app";
    static final String START = "https://" + HOST + "/";

    private WebView web;
    private BillingBridge billing;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFFFFFF);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // 화면이 상태바·내비게이션바·키보드 아래로 들어가지 않게 여백을 준다.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " EumChatApp/1.1");

        billing = new BillingBridge(this, web);
        web.addJavascriptInterface(billing, "EumNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
                // 이음챗 밖의 주소(구독 관리, 메일 등)는 휴대폰의 다른 앱으로 연다.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    view.loadDataWithBaseURL(null,
                        "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
                        + "<body style='font-family:sans-serif;text-align:center;padding:40% 24px;color:#333'>"
                        + "<h2>연결할 수 없습니다</h2><p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>"
                        + "<button style='padding:12px 28px;border:0;border-radius:12px;background:#FF5A3C;color:#fff;font-size:16px' "
                        + "onclick=\"location.href='" + START + "'\">다시 시도</button></body></html>",
                        "text/html", "utf-8", null);
                }
            }
        });

        String url = START;
        Uri data = getIntent().getData();
        if (data != null && HOST.equals(data.getHost())) url = data.toString();
        if (state != null) web.restoreState(state); else web.loadUrl(url);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && HOST.equals(data.getHost())) web.loadUrl(data.toString());
    }

    @Override
    public void onBackPressed() {
        // 열려 있는 창·대화방이 있으면 먼저 닫고, 없으면 앱을 닫는다.
        web.evaluateJavascript("(window.__eumBack&&window.__eumBack())?1:0", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        billing.end();
        web.destroy();
        super.onDestroy();
    }
}
