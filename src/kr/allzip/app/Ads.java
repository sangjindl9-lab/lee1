package kr.allzip.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * 자체 배너광고. 이음 앱 통합 광고 서버(ADS_URL)에서 이 앱(APP_ID) 배너 목록을 받아 자리(home/result/compress)에 표시한다.
 * 서버에 배너가 없거나 통신이 안 되면 아무것도 표시하지 않는다(자리도 차지하지 않음).
 * 수집하는 정보 없음: 노출·클릭 횟수만 배너 ID 단위로 서버에 보낸다.
 */
final class Ads {

    static final String ADS_URL = "https://ads-production-a599.up.railway.app"; // 이음 앱 통합 광고 서버
    static final String APP_ID = "eum-zip";
    private static final long REFRESH_MS = 30L * 60 * 1000;  // 30분마다 목록 갱신
    private static final int SLOT_W = 1080, SLOT_H = 180;    // 권장 배너 비율 6:1

    static final class Banner {
        String id, title, image, link, position;
        int weight = 1;
    }

    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static List<Banner> cache;          // 메모리 캐시
    private static long cacheAt;
    private static boolean loading;
    private static final List<Runnable> waiters = new ArrayList<Runnable>();

    private Ads() {}

    // ------------------------------------------------------------ 목록 받기

    private static File listFile(Context c) { return new File(c.getCacheDir(), "ads_list.json"); }

    private static List<Banner> parse(String json) {
        List<Banner> out = new ArrayList<Banner>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Banner b = new Banner();
                b.id = o.optString("id");
                b.title = o.optString("title");
                b.image = o.optString("image");
                if (b.image.startsWith("/")) b.image = ADS_URL + b.image;
                b.link = o.optString("link");
                b.position = o.optString("slot", "home");
                b.weight = 1;
                if (b.id.length() > 0 && b.image.startsWith("http") && b.link.startsWith("http")) out.add(b);
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** 목록을 준비한 뒤 cb 를 UI 스레드에서 호출. 캐시가 있으면 즉시, 없으면 받아서. */
    private static void load(final Context ctx, final Runnable cb) {
        final Context app = ctx.getApplicationContext();
        long now = System.currentTimeMillis();
        if (cache != null && now - cacheAt < REFRESH_MS) { cb.run(); return; }
        if (cache == null) {
            // 디스크 캐시 먼저 (앱 켜자마자 깜빡임 없이)
            try {
                File f = listFile(app);
                if (f.exists()) {
                    cache = parse(readAll(new FileInputStream(f)));
                    cacheAt = f.lastModified();
                    if (now - cacheAt < REFRESH_MS) { cb.run(); return; }
                }
            } catch (Exception ignored) { }
        }
        synchronized (waiters) {
            waiters.add(cb);
            if (loading) return;
            loading = true;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                List<Banner> fresh = null;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(ADS_URL + "/api/banners?app=" + APP_ID).openConnection();
                    c.setConnectTimeout(5000);
                    c.setReadTimeout(5000);
                    c.setRequestProperty("User-Agent", "EumZIP-Android");
                    if (c.getResponseCode() == 200) {
                        String s = readAll(c.getInputStream());
                        fresh = parse(s);
                        OutputStream os = new FileOutputStream(listFile(app));
                        os.write(s.getBytes("UTF-8"));
                        os.close();
                    }
                    c.disconnect();
                } catch (Exception ignored) { }
                final List<Banner> result = fresh;
                ui.post(new Runnable() {
                    @Override public void run() {
                        if (result != null) { cache = result; cacheAt = System.currentTimeMillis(); }
                        else if (cache == null) { cache = new ArrayList<Banner>(); cacheAt = System.currentTimeMillis() - REFRESH_MS + 60000; } // 실패: 1분 뒤 재시도
                        List<Runnable> ws;
                        synchronized (waiters) { ws = new ArrayList<Runnable>(waiters); waiters.clear(); loading = false; }
                        for (Runnable r : ws) r.run();
                    }
                });
            }
        }, "ads-list").start();
    }

    private static String readAll(InputStream in) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        char[] buf = new char[4096];
        int n;
        while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
        r.close();
        return sb.toString();
    }

    /** 서버가 순서대로 보내 주므로 그 자리의 첫 번째 배너를 쓴다. */
    private static Banner pick(String position) {
        if (cache == null) return null;
        for (Banner b : cache) if (position.equals(b.position)) return b;
        return null;
    }

    // ------------------------------------------------------------ 이미지

    private static File imgFile(Context c, Banner b) { return new File(c.getCacheDir(), "ads_" + b.id + ".img"); }

    private static void loadImage(final Context ctx, final Banner b, final ImageView into) {
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                Bitmap bm = null;
                try {
                    File f = imgFile(app, b);
                    byte[] data = null;
                    if (f.exists() && System.currentTimeMillis() - f.lastModified() < 24L * 3600 * 1000) {
                        data = bytes(new FileInputStream(f));
                    } else {
                        HttpURLConnection c = (HttpURLConnection) new URL(b.image).openConnection();
                        c.setConnectTimeout(5000);
                        c.setReadTimeout(8000);
                        if (c.getResponseCode() == 200) {
                            data = bytes(c.getInputStream());
                            OutputStream os = new FileOutputStream(f);
                            os.write(data);
                            os.close();
                        }
                        c.disconnect();
                    }
                    if (data != null) {
                        BitmapFactory.Options o = new BitmapFactory.Options();
                        o.inJustDecodeBounds = true;
                        BitmapFactory.decodeByteArray(data, 0, data.length, o);
                        int sample = 1;
                        while (o.outWidth / sample > 2200) sample *= 2;
                        o = new BitmapFactory.Options();
                        o.inSampleSize = sample;
                        bm = BitmapFactory.decodeByteArray(data, 0, data.length, o);
                    }
                } catch (Throwable ignored) { }
                final Bitmap fb = bm;
                ui.post(new Runnable() {
                    @Override public void run() {
                        if (fb == null) { hide(into); return; }
                        into.setImageBitmap(fb);
                        show(into);
                        stat(app, b.id, "imp");
                    }
                });
            }
        }, "ads-img").start();
    }

    private static byte[] bytes(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > 3 * 1024 * 1024) break; }
        in.close();
        return bo.toByteArray();
    }

    private static void show(View img) {
        View holder = (View) img.getParent();
        if (holder != null) holder.setVisibility(View.VISIBLE);
    }

    private static void hide(View img) {
        View holder = (View) img.getParent();
        if (holder != null) holder.setVisibility(View.GONE);
    }

    // ------------------------------------------------------------ 통계

    private static void stat(final Context app, final String id, final String type) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(ADS_URL + "/api/banners/" + id + "/" + type).openConnection();
                    c.setConnectTimeout(4000);
                    c.setReadTimeout(4000);
                    c.setDoOutput(true);
                    c.setRequestMethod("POST");
                    c.setFixedLengthStreamingMode(0);
                    c.getOutputStream().close();
                    c.getResponseCode();
                    c.disconnect();
                } catch (Exception ignored) { }
            }
        }, "ads-stat").start();
    }

    // ------------------------------------------------------------ 화면에 붙이기

    /**
     * 배너 자리를 만든다. 처음엔 숨김(GONE) 상태이고, 배너가 있으면 이미지가 로드된 뒤에 나타난다.
     * @param position "home" | "result" | "compress"
     */
    static View slot(final Activity act, final String position) {
        final float d = act.getResources().getDisplayMetrics().density;
        final FrameLayout holder = new FrameLayout(act);
        holder.setVisibility(View.GONE);
        holder.setPadding((int) (16 * d), (int) (6 * d), (int) (16 * d), (int) (6 * d));

        final ImageView img = new ImageView(act);
        img.setScaleType(ImageView.ScaleType.FIT_XY);
        img.setAdjustViewBounds(true);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFFFFFFF);
        bg.setCornerRadius(12 * d);
        img.setBackground(bg);
        img.setClipToOutline(true);
        FrameLayout.LayoutParams ip = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        holder.addView(img, ip);

        TextView adMark = new TextView(act);
        adMark.setText("광고");
        adMark.setTextSize(TypedValue.COMPLEX_UNIT_SP, 9);
        adMark.setTextColor(Color.WHITE);
        adMark.setPadding((int) (5 * d), (int) (1 * d), (int) (5 * d), (int) (1 * d));
        GradientDrawable mb = new GradientDrawable();
        mb.setColor(0x88000000);
        mb.setCornerRadius(6 * d);
        adMark.setBackground(mb);
        FrameLayout.LayoutParams mp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        mp.gravity = Gravity.TOP | Gravity.END;
        mp.topMargin = (int) (10 * d);
        mp.rightMargin = (int) (20 * d);
        holder.addView(adMark, mp);

        load(act, new Runnable() {
            @Override public void run() {
                if (act.isFinishing() || act.isDestroyed()) return;
                final Banner b = pick(position);
                if (b == null) { holder.setVisibility(View.GONE); return; }
                img.setContentDescription(b.title);
                img.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        stat(act.getApplicationContext(), b.id, "click");
                        try {
                            act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(b.link)));
                        } catch (Exception ignored) { }
                    }
                });
                loadImage(act, b, img);
            }
        });
        return holder;
    }
}
