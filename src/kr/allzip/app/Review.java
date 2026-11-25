package kr.allzip.app;

import kr.allzip.core.L;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

/**
 * 평가 요청. 압축 풀기·압축하기가 성공한 횟수를 세다가 3번째 성공부터 한 번 "평가해 주세요" 창을 띄운다.
 * "나중에"를 누르면 10번 더 성공한 뒤 다시 묻고, "평가하기"나 "다시 보지 않기"를 누르면 다시 묻지 않는다.
 * 보상은 주지 않는다(정책상 금지).
 */
final class Review {
    private static final int FIRST_AT = 3, LATER_GAP = 10;

    private Review() {}

    /** 성공할 때마다 호출. ask=true 인 자리에서만 창을 띄운다(다른 창과 겹치지 않게). */
    static void success(final Activity act, boolean ask) {
        final SharedPreferences p = act.getSharedPreferences("eum", Activity.MODE_PRIVATE);
        if (p.getBoolean("review_done", false)) return;
        int n = p.getInt("review_ok", 0) + 1;
        p.edit().putInt("review_ok", n).apply();
        if (!ask || n < p.getInt("review_next", FIRST_AT)) return;
        if (act.isFinishing() || act.isDestroyed()) return;
        new AlertDialog.Builder(act)
                .setTitle(L.t("이음ZIP이 도움이 되셨나요?"))
                .setMessage(L.t("별점과 리뷰를 남겨 주시면 앱을 더 좋게 만드는 데 큰 힘이 됩니다."))
                .setPositiveButton(L.t("평가하기"), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        p.edit().putBoolean("review_done", true).apply();
                        String pkg = act.getPackageName();
                        try {
                            act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
                        } catch (Exception e) {
                            try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg))); } catch (Exception ignored) { }
                        }
                    }
                })
                .setNeutralButton(L.t("다시 보지 않기"), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { p.edit().putBoolean("review_done", true).apply(); }
                })
                .setNegativeButton(L.t("나중에"), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        p.edit().putInt("review_next", p.getInt("review_ok", 0) + LATER_GAP).apply();
                    }
                })
                .setOnCancelListener(new DialogInterface.OnCancelListener() {
                    @Override public void onCancel(DialogInterface d) {
                        p.edit().putInt("review_next", p.getInt("review_ok", 0) + LATER_GAP).apply();
                    }
                })
                .show();
    }
}
