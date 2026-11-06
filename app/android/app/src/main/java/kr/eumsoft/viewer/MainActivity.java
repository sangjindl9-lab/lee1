package kr.eumsoft.viewer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EumFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** 뒤로 가기는 앱을 바로 끄지 않고 화면(JS)에 넘긴다 — 문서 중이면 확인 창을 띄우고, 홈에서는 두 번 눌러 종료. */
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().triggerWindowJSEvent("eumBack");
        else super.onBackPressed();
    }
}
