package kr.ssjr.narabid;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** 입찰정보 사이트(narabid-info.onrender.com)를 그대로 보여주는 앱. 사이트가 바뀌면 앱도 자동으로 최신 화면. */
public class MainActivity extends Activity {
    static final String HOST = "narabid-info.onrender.com";
    static final String HOME = "https://" + HOST + "/";
    static final int BRAND = Color.parseColor("#1B3A63");

    WebView web;
    ProgressBar bar;
    View splash, errorView;
    TextView splashMsg;
    long lastBack;
    boolean firstLoaded;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);

        web = new WebView(this);
        root.addView(web, match());

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        splash = buildSplash();
        root.addView(splash, match());
        errorView = buildError();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, match());
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false); // target=_blank 도 이 화면에서 처리 → 외부 링크는 아래에서 브라우저로
        s.setUserAgentString(s.getUserAgentString() + " NarabidApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "NarabidApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                firstLoaded = true;
                splash.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    splash.setVisibility(View.GONE);
                    errorView.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
                if (!firstLoaded && p > 10) splashMsg.setText("화면을 불러오는 중…");
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(Uri.parse(url)));

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);
    }

    void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception e) {
            Toast.makeText(this, "열 수 있는 앱이 없습니다", Toast.LENGTH_SHORT).show();
        }
    }

    /** 웹 화면의 '엑셀 다운로드' → 휴대폰 '다운로드' 폴더에 저장 후 열기 */
    class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String base64, String mime) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                Uri uri;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(data); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, name);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                    uri = null;
                }
                final Uri open = uri;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "다운로드 폴더에 저장했습니다\n" + name, Toast.LENGTH_LONG).show();
                    if (open != null) {
                        try {
                            Intent i = new Intent(Intent.ACTION_VIEW);
                            i.setDataAndType(open, mime);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(i);
                        } catch (Exception ignored) { /* 엑셀 앱이 없으면 저장만 */ }
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "저장 실패: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public String version() { return "1.0"; }
    }

    @Override
    public void onBackPressed() {
        if (errorView.getVisibility() == View.VISIBLE) { super.onBackPressed(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) { super.onBackPressed(); return; }
        lastBack = now;
        Toast.makeText(this, "한 번 더 누르면 종료됩니다", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    View buildSplash() {
        LinearLayout l = column(BRAND);
        TextView t = text("입찰정보", 28, Color.WHITE);
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        l.addView(t);
        splashMsg = text("서버에 연결하는 중…\n처음 열 때는 30초쯤 걸릴 수 있어요", 14, Color.parseColor("#C9D6E8"));
        splashMsg.setPadding(0, dp(16), 0, dp(20));
        l.addView(splashMsg);
        l.addView(new ProgressBar(this));
        return l;
    }

    View buildError() {
        LinearLayout l = column(Color.WHITE);
        l.addView(text("연결할 수 없습니다", 20, BRAND));
        TextView m = text("인터넷 연결을 확인한 뒤 다시 시도해 주세요", 14, Color.GRAY);
        m.setPadding(0, dp(10), 0, dp(20));
        l.addView(m);
        Button b = new Button(this);
        b.setText("다시 시도");
        b.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            splash.setVisibility(View.VISIBLE);
            web.loadUrl(HOME);
        });
        l.addView(b);
        return l;
    }

    LinearLayout column(int bg) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(bg);
        l.setPadding(dp(32), 0, dp(32), 0);
        l.setClickable(true);
        return l;
    }

    TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
