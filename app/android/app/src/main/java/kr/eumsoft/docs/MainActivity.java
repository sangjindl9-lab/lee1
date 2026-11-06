package kr.eumsoft.docs;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EumFilesPlugin.class);
        super.onCreate(savedInstanceState);
        // 뒤로 가기 버튼으로 앱이 바로 꺼지지 않게, 화면 쪽에 알려 확인 창을 띄우게 한다.
        // 다른 등록보다 나중에 등록해야 이 처리가 먼저 불린다.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('eumBack'))", null);
            }
        });
    }
}
