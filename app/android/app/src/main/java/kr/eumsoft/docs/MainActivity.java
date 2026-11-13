package kr.eumsoft.docs;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

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
        checkUpdate();
    }

    /** 구글 플레이에 새 버전이 있으면 "업데이트" 화면을 띄운다(플레이 인앱 업데이트). 플레이로 설치한 앱에서만 동작한다. */
    private void checkUpdate() {
        AppUpdateManager manager = AppUpdateManagerFactory.create(this);
        manager.getAppUpdateInfo().addOnSuccessListener(info -> {
            int a = info.updateAvailability();
            boolean wanted = a == UpdateAvailability.UPDATE_AVAILABLE || a == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
            if (!wanted || !info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) return;
            try {
                manager.startUpdateFlowForResult(info, this, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(), 9001);
            } catch (Exception ignored) {}
        });
    }
}
