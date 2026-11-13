package kr.allzip.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 새 버전 안내. 앱이 켜질 때 통합 서버(Ads.ADS_URL)의 /api/version 을 받아
 * 설치된 versionCode 보다 크면 "업데이트" 창을 띄우고, 버튼은 Play 스토어의 이 앱 페이지를 연다.
 * 인터넷이 없거나 서버가 응답하지 않으면 조용히 넘어간다.
 */
final class Update {

    private static final String PLAY = "market://details?id=";
    private static final String PLAY_WEB = "https://play.google.com/store/apps/details?id=";
    private static boolean checked;   // 프로세스당 한 번만 (화면 회전 등으로 반복되지 않게)

    private Update() {}

    static void check(final Activity act) {
        if (checked) return;
        checked = true;
        final int myCode;
        try {
            myCode = act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionCode;
        } catch (Exception e) { return; }
        final Handler ui = new Handler(Looper.getMainLooper());
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(Ads.ADS_URL + "/api/version?app=" + Ads.APP_ID).openConnection();
                    c.setConnectTimeout(5000);
                    c.setReadTimeout(5000);
                    if (c.getResponseCode() != 200) return;
                    BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();
                    c.disconnect();
                    final JSONObject o = new JSONObject(sb.toString());
                    if (o.optInt("code") <= myCode) return;
                    ui.post(new Runnable() {
                        @Override public void run() { show(act, o); }
                    });
                } catch (Exception ignored) { }
            }
        }, "update-check").start();
    }

    private static void show(final Activity act, JSONObject o) {
        if (act.isFinishing() || act.isDestroyed()) return;
        String name = o.optString("name");
        String notes = o.optString("notes");
        StringBuilder msg = new StringBuilder("이음ZIP 새 버전");
        if (name.length() > 0) msg.append(' ').append(name);
        msg.append("이 나왔습니다.\n지금 업데이트하면 바로 새 기능을 쓸 수 있습니다.");
        if (notes.length() > 0) msg.append("\n\n").append(notes);
        AlertDialog.Builder b = new AlertDialog.Builder(act)
                .setTitle("업데이트가 있습니다")
                .setMessage(msg)
                .setPositiveButton("업데이트", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { openStore(act); }
                });
        if (o.optBoolean("force")) b.setCancelable(false);
        else b.setNegativeButton("나중에", null);
        b.show();
    }

    private static void openStore(Activity act) {
        String pkg = act.getPackageName();
        try {
            act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PLAY + pkg)));
        } catch (Exception e) {
            try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PLAY_WEB + pkg))); } catch (Exception ignored) { }
        }
    }
}
